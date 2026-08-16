import * as scheduleStore from './schedule-store.js';
import * as reminderStore from './reminder-store.js';
import * as activityStore from './activity-store.js';

export type ActionItemStatus = 'upcoming' | 'today' | 'overdue' | 'completed';

export interface ActionItem {
  id: string;
  sourceType: 'schedule' | 'reminder';
  sourceId: string;
  instanceId: string | null;
  title: string;
  dueAt: string;
  allDay: boolean;
  status: ActionItemStatus;
  priority: 'high' | 'medium' | 'low';
  nextAction: string;
  itemType: 'event' | 'todo' | 'recurring';
  isUnscheduled: boolean;
  completedAt: string | null;
  completionId: string | null;
  proof: {
    note: string | null;
    billDate: string | null;
    attachments: Array<{ id: string; originalName: string; mimeType: string; sizeBytes: number }>;
  } | null;
}

export interface ActionCenterResult {
  next: ActionItem | null;
  unscheduled: ActionItem[];
  today: ActionItem[];
  tomorrow: ActionItem[];
  upcoming: ActionItem[];
  overdue: ActionItem[];
  completedToday: ActionItem[];
  generatedAt: string;
  upcomingDays: number;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function dateInTimezone(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dateOnly(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function endOfWindow(today: string, days: number): string {
  return reminderStore.addDays(today, days);
}

function priorityScore(priority: string): number {
  return priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
}

function chooseNext(items: ActionItem[], now: Date): ActionItem | null {
  const actionableItems = items.filter(item => !item.isUnscheduled);
  const twoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  return [...actionableItems].sort((a, b) => {
    const aSoonEvent = a.itemType === 'event' && a.dueAt <= twoHours && a.dueAt >= now.toISOString() ? 1 : 0;
    const bSoonEvent = b.itemType === 'event' && b.dueAt <= twoHours && b.dueAt >= now.toISOString() ? 1 : 0;
    if (aSoonEvent !== bSoonEvent) return bSoonEvent - aSoonEvent;
    const statusScore = (item: ActionItem) => item.status === 'overdue' ? 3 : item.status === 'today' ? 2 : 1;
    const statusDiff = statusScore(b) - statusScore(a);
    if (statusDiff) return statusDiff;
    const priorityDiff = priorityScore(b.priority) - priorityScore(a.priority);
    if (priorityDiff) return priorityDiff;
    return a.dueAt.localeCompare(b.dueAt);
  })[0] || null;
}

export function getActionCenter(userId: string, upcomingDays = 7, now = new Date()): ActionCenterResult {
  const safeDays = [3, 7, 14].includes(upcomingDays) ? upcomingDays : 7;
  const timezone = process.env.APP_TIMEZONE || 'Asia/Shanghai';
  const today = reminderStore.todayInTimezone(timezone);
  const windowEnd = endOfWindow(today, safeDays);
  const completions = activityStore.listCompletions(userId);
  const latestCompletion = new Map<string, activityStore.CompletionRecord>();
  for (const completion of completions) {
    if (completion.reopenedAt) continue;
    const key = `${completion.sourceType}:${completion.sourceId}:${completion.instanceId || ''}`;
    if (!latestCompletion.has(key)) latestCompletion.set(key, completion);
  }

  const proofFor = (completion?: activityStore.CompletionRecord | null): ActionItem['proof'] => completion ? {
    note: completion.note,
    billDate: completion.billDate,
    attachments: activityStore.listAttachments(userId, completion.id).map(file => ({
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
  } : null;

  const items: ActionItem[] = [];
  const unscheduledItems: ActionItem[] = [];
  for (const schedule of scheduleStore.getAllSchedules(userId)) {
    // 周期事务会生成日历全天待办；行动中心仍使用周期事务本体，避免重复两条。
    if (schedule.id.startsWith('reminder-cycle:')) continue;
    const dueDate = dateOnly(schedule.start_time);
    const completion = latestCompletion.get(`schedule:${schedule.id}:`);
    const completed = schedule.is_completed || !!completion;
    const isUnscheduled = schedule.is_unscheduled === true;
    let status: ActionItemStatus | null = null;
    if (completed && dateInTimezone(completion?.completedAt || schedule.updated_at, timezone) === today) status = 'completed';
    else if (completed) continue;
    else if (isUnscheduled) status = 'today';
    else if (schedule.type === 'todo' && dueDate < today) status = 'overdue';
    else if (dueDate === today) status = 'today';
    else if (dueDate > today && dueDate <= windowEnd) status = 'upcoming';
    if (!status) continue;
    const actionItem: ActionItem = {
      id: `schedule:${schedule.id}`,
      sourceType: 'schedule',
      sourceId: schedule.id,
      instanceId: null,
      title: schedule.title,
      dueAt: schedule.start_time,
      allDay: schedule.all_day,
      status,
      priority: schedule.priority,
      nextAction: schedule.notes?.trim() || '',
      itemType: schedule.type === 'todo' ? 'todo' : 'event',
      isUnscheduled,
      completedAt: completion?.completedAt || (completed ? schedule.updated_at : null),
      completionId: completion?.id || null,
      proof: proofFor(completion),
    };
    if (isUnscheduled && status === 'today') unscheduledItems.push(actionItem);
    else items.push(actionItem);
  }

  const reminderTasks = reminderStore.listReminderTasks(userId);
  const reminderTaskMap = new Map(reminderTasks.map(task => [task.id, task]));
  for (const task of reminderTasks) {
    const cycle = task.currentCycle;
    if (!cycle) continue;
    const completion = latestCompletion.get(`reminder:${task.id}:${cycle.id}`);
    const completed = cycle.status === 'completed' || !!completion;
    let status: ActionItemStatus | null = null;
    if (completed && dateInTimezone(completion?.completedAt || cycle.completedAt || cycle.updatedAt, timezone) === today) status = 'completed';
    else if (completed || !task.enabled) continue;
    else if (cycle.status === 'expired' || cycle.dueDate < today) status = 'overdue';
    else if (cycle.dueDate === today) status = 'today';
    else if (cycle.dueDate <= windowEnd) status = 'upcoming';
    if (!status) continue;
    const config = task.config as any;
    items.push({
      id: `reminder:${task.id}:${cycle.id}`,
      sourceType: 'reminder',
      sourceId: task.id,
      instanceId: cycle.id,
      title: task.name,
      dueAt: `${cycle.dueDate}T23:59:59`,
      allDay: true,
      status,
      priority: config.priority || 'medium',
      nextAction: config.actionGuide || config.nextAction || '完成本周期事务并登记证明',
      itemType: 'recurring',
      isUnscheduled: false,
      completedAt: completion?.completedAt || cycle.completedAt,
      completionId: completion?.id || null,
      proof: proofFor(completion),
    });
  }

  // 周期事务完成后会立即推进到下一周期，因此从完成记录补回当天已完成的旧周期。
  for (const completion of completions) {
    if (completion.sourceType !== 'reminder' || completion.reopenedAt || dateInTimezone(completion.completedAt, timezone) !== today) continue;
    const id = `reminder:${completion.sourceId}:${completion.instanceId || ''}`;
    if (items.some(item => item.id === id)) continue;
    const task = reminderTaskMap.get(completion.sourceId);
    if (!task) continue;
    const config = task.config as any;
    items.push({
      id,
      sourceType: 'reminder',
      sourceId: task.id,
      instanceId: completion.instanceId,
      title: task.name,
      dueAt: completion.completedAt,
      allDay: true,
      status: 'completed',
      priority: config.priority || 'medium',
      nextAction: config.actionGuide || '本周期已完成',
      itemType: 'recurring',
      isUnscheduled: false,
      completedAt: completion.completedAt,
      completionId: completion.id,
      proof: proofFor(completion),
    });
  }

  const sortItems = (list: ActionItem[]) => list.sort((a, b) => {
    const priorityDiff = priorityScore(b.priority) - priorityScore(a.priority);
    return priorityDiff || a.dueAt.localeCompare(b.dueAt);
  });
  const todayItems = sortItems(items.filter(item => item.status === 'today'));
  const unscheduled = sortItems(unscheduledItems);
  const tomorrowDate = endOfWindow(today, 1);
  const tomorrow = sortItems(items.filter(item => item.status === 'upcoming' && dateOnly(item.dueAt) === tomorrowDate));
  const upcoming = sortItems(items.filter(item => item.status === 'upcoming'));
  const overdue = sortItems(items.filter(item => item.status === 'overdue'));
  const completedToday = items.filter(item => item.status === 'completed').sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  return {
    next: chooseNext([...todayItems, ...upcoming, ...overdue], now),
    unscheduled,
    today: todayItems,
    tomorrow,
    upcoming,
    overdue,
    completedToday,
    generatedAt: now.toISOString(),
    upcomingDays: safeDays,
  };
}
