import * as activityStore from './activity-store.js';
import * as db from './db.js';
import { sendQueuedNotificationEmail } from './email-service.js';

function timeInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function inQuietHours(value: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? value >= start && value < end : value >= start || value < end;
}

function quietAdjustedDate(userId: string, scheduledAt: string): string {
  const preference = db.getReminder(userId);
  if (!preference?.quiet_hours_enabled) return scheduledAt;
  const timezone = preference.timezone || 'Asia/Shanghai';
  const date = new Date(scheduledAt);
  const localTime = timeInTimezone(date, timezone);
  const start = preference.quiet_start || '22:00';
  const end = preference.quiet_end || '08:00';
  if (!inQuietHours(localTime, start, end)) return scheduledAt;
  const [endHour, endMinute] = end.split(':').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  let minutesUntilEnd = (endHour * 60 + endMinute) - (hour * 60 + minute);
  if (minutesUntilEnd <= 0) minutesUntilEnd += 24 * 60;
  return new Date(date.getTime() + minutesUntilEnd * 60_000).toISOString();
}

export function enqueueUserNotification(input: {
  userId: string;
  sourceType: string;
  sourceId: string;
  instanceId?: string | null;
  kind: string;
  title: string;
  body: string;
  scheduledAt?: string;
  dedupePrefix: string;
}): activityStore.NotificationDelivery[] {
  const preference = db.getReminder(input.userId);
  const scheduledAt = quietAdjustedDate(input.userId, input.scheduledAt || new Date().toISOString());
  const channels: activityStore.NotificationChannel[] = [];
  if (preference?.email_enabled !== 0) channels.push('email');
  if (preference?.in_app_enabled !== 0) channels.push('in_app');
  if (preference?.browser_enabled !== 0) channels.push('browser');
  return channels.map(channel => activityStore.enqueueNotification({
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    instanceId: input.instanceId,
    channel,
    kind: input.kind,
    title: input.title,
    body: input.body,
    scheduledAt,
    dedupeKey: `${input.dedupePrefix}:${channel}`,
  }));
}

export async function processNotificationQueue(log?: (message: string, error?: unknown) => void): Promise<void> {
  for (const item of activityStore.listDueNotifications()) {
    if (!activityStore.claimNotification(item.id)) continue;
    try {
      if (item.channel === 'email') {
        const email = db.getReminderEmail(item.userId);
        if (!email) throw new Error('用户没有可用的提醒邮箱');
        await sendQueuedNotificationEmail(email, item.title, item.body);
      }
      activityStore.markNotificationSent(item.id);
      log?.(`通知发送成功: ${item.channel} / ${item.title}`);
    } catch (error) {
      activityStore.markNotificationFailed(item.id, error instanceof Error ? error.message : String(error));
      log?.(`通知发送失败: ${item.channel} / ${item.title}`, error);
    }
  }
}
