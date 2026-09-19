import * as scheduleStore from './schedule-store.js';
import { validateScheduleTime } from './schedule-time.js';

export const SCHEDULE_CATEGORIES = new Set(['travel', 'work', 'social', 'life', 'health', 'other']);

export function resolveUserCalendarId(userId: string, requested: unknown): string {
  const value = String(requested || 'personal').trim();
  if (!value || value.length > 200) throw new Error('日历编号不正确');
  const calendars = scheduleStore.getAllCalendars(userId);
  const calendar = calendars.find(item => item.id === value)
    || calendars.find(item => item.id.endsWith(':' + value));
  if (!calendar) throw new Error('目标日历不存在或无权访问');
  return calendar.id;
}

export function scheduleText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value == null || value === '') return undefined;
  const text = String(value);
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return text;
}

export function normaliseScheduleApiFields(
  body: Record<string, unknown>,
  userId: string,
  existing?: scheduleStore.Schedule,
): Partial<scheduleStore.Schedule> {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const updates: Partial<scheduleStore.Schedule> = {};
  if (!existing || has('calendar_id')) updates.calendar_id = resolveUserCalendarId(userId, body.calendar_id);
  if (!existing || has('title')) {
    const title = String(body.title || '').trim();
    if (!title) throw new Error('日程标题不能为空');
    if (title.length > 200) throw new Error('日程标题不能超过 200 个字符');
    updates.title = title;
  }
  if (!existing || has('type')) {
    if (body.type !== 'event' && body.type !== 'todo' && body.type != null) throw new Error('日程类型不正确');
    updates.type = body.type === 'todo' ? 'todo' : 'event';
  }
  if (!existing || has('description')) updates.description = scheduleText(body.description, '日程描述', 5_000);
  if (!existing || has('start_time')) updates.start_time = String(body.start_time || '');
  if (!existing || has('end_time')) updates.end_time = scheduleText(body.end_time, '结束时间', 64);
  if (!existing || has('all_day')) updates.all_day = body.all_day === true;
  if (!existing || has('is_unscheduled')) updates.is_unscheduled = body.is_unscheduled === true;
  if (!existing || has('location')) updates.location = scheduleText(body.location, '地点', 500);
  if (!existing || has('notes')) updates.notes = scheduleText(body.notes, '备注', 10_000);
  if (!existing || has('category')) {
    const category = String(body.category || 'other');
    if (!SCHEDULE_CATEGORIES.has(category)) throw new Error('日程分类不正确');
    updates.category = category;
  }
  if (!existing || has('priority')) {
    const priority = body.priority == null ? 'medium' : String(body.priority);
    if (!['high', 'medium', 'low'].includes(priority)) throw new Error('优先级不正确');
    updates.priority = priority as scheduleStore.Schedule['priority'];
  }
  if (!existing || has('is_completed')) updates.is_completed = body.is_completed === true;
  if (!existing || has('is_repeated')) updates.is_repeated = body.is_repeated === true;
  if (!existing || has('repeat_rule')) updates.repeat_rule = scheduleText(body.repeat_rule, '重复规则', 2_000);
  if (!existing || has('reminders')) {
    if (body.reminders != null && !Array.isArray(body.reminders)) throw new Error('提醒设置必须是数组');
    const reminders = (Array.isArray(body.reminders) ? body.reminders : []).map(value => String(value));
    if (reminders.length > 20 || reminders.some(value => value.length > 100)) throw new Error('提醒设置过多或内容过长');
    updates.reminders = reminders;
  }
  if (!existing || has('is_high_risk')) updates.is_high_risk = body.is_high_risk === true;

  const merged = { ...(existing || {}), ...updates } as Partial<scheduleStore.Schedule>;
  if (!existing || ['type', 'all_day', 'is_unscheduled', 'start_time', 'end_time'].some(has)) validateScheduleTime(merged);
  return updates;
}

// 获取所有日程
