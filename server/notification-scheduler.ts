import * as db from './db.js';
import * as scheduleStore from './schedule-store.js';
import { todayInTimezone } from './reminder-store.js';
import { enqueueUserEmailNotification, enqueueUserNotification } from './notification-service.js';
import type { DbReminder } from './db.js';
import type { Schedule } from './schedule-store.js';

const MINUTE_MS = 60_000;
const HIGH_PRIORITY_WINDOW_MS = 15 * MINUTE_MS;

export interface DailyDigestScheduleResult {
  scanned: number;
  due: number;
  queued: number;
}

export interface HighPriorityScheduleResult {
  usersScanned: number;
  schedulesScanned: number;
  due: number;
  queued: number;
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export type NotificationSchedulerLogger = (message: string, error?: unknown) => void;

function timePartsInTimezone(date: Date, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: date.getUTCMilliseconds(),
  };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = timePartsInTimezone(date, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return localAsUtc - date.getTime();
}

/**
 * 解析日程保存的开始时间。表单产生的是不带偏移量的用户本地时间，AI/导入数据也可能带 Z 或显式偏移量。
 */
export function parseScheduleStart(value: string, timezone: string): Date | null {
  const input = String(value || '').trim();
  if (!input) return null;

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(input)) {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
  const wallTimeMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, '0')),
  );
  if (Number.isNaN(wallTimeMs)) return null;
  const wallTime = new Date(wallTimeMs);
  if (
    wallTime.getUTCFullYear() !== Number(year)
    || wallTime.getUTCMonth() !== Number(month) - 1
    || wallTime.getUTCDate() !== Number(day)
    || wallTime.getUTCHours() !== Number(hour)
    || wallTime.getUTCMinutes() !== Number(minute)
    || wallTime.getUTCSeconds() !== Number(second)
    || wallTime.getUTCMilliseconds() !== Number(millisecond.padEnd(3, '0'))
  ) return null;

  let candidate = new Date(wallTimeMs);
  try {
    // Recalculate once after applying the offset so DST transitions use the offset at the target instant.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const adjusted = new Date(wallTimeMs - timezoneOffsetMs(candidate, timezone));
      if (adjusted.getTime() === candidate.getTime()) return adjusted;
      candidate = adjusted;
    }
    return candidate;
  } catch {
    return null;
  }
}

function hasExplicitStartTime(schedule: Schedule): boolean {
  return /[T ]\d{2}:\d{2}/.test(String(schedule.start_time || ''));
}

function isHighPrioritySchedule(schedule: Schedule): boolean {
  return (schedule.type === 'event' || schedule.type === 'todo')
    && schedule.priority === 'high'
    && !schedule.is_completed
    && !schedule.all_day
    && !schedule.is_unscheduled
    && hasExplicitStartTime(schedule);
}

function highPriorityEmailBody(schedule: Schedule, now: Date, timezone: string): string {
  const start = parseScheduleStart(schedule.start_time, timezone);
  const minutes = start ? Math.max(1, Math.ceil((start.getTime() - now.getTime()) / MINUTE_MS)) : 15;
  const details = [
    `距离开始还有约 ${minutes} 分钟。`,
    `开始时间：${schedule.start_time.replace('T', ' ').slice(0, 19)}`,
  ];
  if (schedule.location?.trim()) details.push(`地点：${schedule.location.trim()}`);
  if (schedule.notes?.trim()) details.push(`备注：${schedule.notes.trim()}`);
  return details.join('\n');
}

/** 每分钟调用一次；只负责把到点的每日摘要放入现有通知队列。 */
export function enqueueDueDailyDigestNotifications(
  now = new Date(),
  log?: NotificationSchedulerLogger,
): DailyDigestScheduleResult {
  const reminders = db.getAllEnabledReminders();
  let due = 0;
  let queued = 0;
  for (const reminder of reminders) {
    try {
      const timezone = reminder.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
      const local = timePartsInTimezone(now, timezone);
      if (reminder.hour !== local.hour || reminder.minute !== local.minute) continue;
      due += 1;
      const localDate = todayInTimezone(timezone, now);
      const schedules = scheduleStore.getSchedulesByDate(localDate, reminder.user_id).filter(item => !item.is_completed);
      const notifications = enqueueUserNotification({
        userId: reminder.user_id,
        sourceType: 'digest',
        sourceId: localDate,
        kind: 'daily_digest',
        title: `今日行动提醒 · ${schedules.length} 项待处理`,
        body: schedules.length ? schedules.map(item => `${item.start_time.slice(11, 16)} ${item.title}`).join('\n') : '今天暂无未完成日程。',
        scheduledAt: now.toISOString(),
        dedupePrefix: `daily:${reminder.user_id}:${localDate}`,
      });
      queued += notifications.length;
    } catch (error) {
      // 无效时区等单账号配置不应阻断其他账号的扫描。
      log?.(`跳过账号 ${reminder.user_id} 的每日摘要扫描`, error);
    }
  }
  return { scanned: reminders.length, due, queued };
}

/**
 * 每分钟调用一次；在开始前 1–15 分钟把高优先级日程作为固定邮件入队。
 * 直接写入 email channel，故意绕过每日提醒开关、邮件开关和免打扰时间。
 */
export function enqueueDueHighPriorityScheduleEmails(
  now = new Date(),
  log?: NotificationSchedulerLogger,
): HighPriorityScheduleResult {
  const users = db.getAllUsers().filter(user => !user.disabled);
  let schedulesScanned = 0;
  let due = 0;
  let queued = 0;
  for (const user of users) {
    const preference: DbReminder | undefined = db.getReminder(user.id);
    const timezone = preference?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
    try {
      const schedules = scheduleStore.getAllSchedules(user.id);
      schedulesScanned += schedules.length;
      for (const schedule of schedules) {
        if (!isHighPrioritySchedule(schedule)) continue;
        const start = parseScheduleStart(schedule.start_time, timezone);
        if (!start) continue;
        const remaining = start.getTime() - now.getTime();
        if (remaining <= 0 || remaining > HIGH_PRIORITY_WINDOW_MS) continue;
        due += 1;
        enqueueUserEmailNotification({
          userId: user.id,
          sourceType: 'schedule',
          sourceId: schedule.id,
          kind: 'high_priority_schedule',
          title: `【高优先级提醒】${schedule.title}`,
          body: highPriorityEmailBody(schedule, now, timezone),
          scheduledAt: now.toISOString(),
          dedupeKey: `high-priority:${schedule.id}:${schedule.start_time}`,
        });
        queued += 1;
      }
    } catch (error) {
      // 单账号日程读取失败不应阻断其他账号的高优先级扫描。
      log?.(`跳过账号 ${user.id} 的高优先级扫描`, error);
    }
  }
  return { usersScanned: users.length, schedulesScanned, due, queued };
}
