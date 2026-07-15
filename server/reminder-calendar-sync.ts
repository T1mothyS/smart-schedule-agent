import * as scheduleStore from './schedule-store.js';
import type {
  GenericReminderConfig,
  ReminderCycle,
  ReminderTaskSummary,
} from './reminder-store.js';

const LINKED_SCHEDULE_PREFIX = 'reminder-cycle:';

export function reminderScheduleId(cycleId: string): string {
  return `${LINKED_SCHEDULE_PREFIX}${cycleId}`;
}

export function isReminderLinkedSchedule(id: string): boolean {
  return id.startsWith(LINKED_SCHEDULE_PREFIX);
}

function priorityFor(task: ReminderTaskSummary): 'high' | 'medium' | 'low' {
  if (task.type === 'credit_card') return 'high';
  if (task.type === 'generic') return (task.config as GenericReminderConfig).priority || 'medium';
  return 'medium';
}

function descriptionFor(task: ReminderTaskSummary, cycle: ReminderCycle): string {
  const actionGuide = task.type === 'generic'
    ? (task.config as GenericReminderConfig).actionGuide
    : '';
  return [
    `周期事务到期：${task.name}`,
    `到期日期：${cycle.dueDate}`,
    actionGuide || '请前往“周期提醒”登记完成情况和证明。',
  ].join('\n');
}

export function syncReminderCycleToCalendar(
  task: ReminderTaskSummary,
  cycle: ReminderCycle,
): scheduleStore.Schedule | null {
  const id = reminderScheduleId(cycle.id);
  const existing = scheduleStore.getSchedule(id);
  if (existing && existing.user_id !== task.userId) return null;

  if (!task.enabled && cycle.status !== 'completed') {
    if (existing) scheduleStore.deleteSchedule(id);
    return null;
  }

  const dateTime = `${cycle.dueDate}T00:00:00`;
  const common = {
    type: 'todo' as const,
    title: task.name,
    description: descriptionFor(task, cycle),
    start_time: dateTime,
    end_time: dateTime,
    all_day: true,
    location: undefined,
    notes: '由周期事务自动生成；请在“周期提醒”中完成或补充证明。',
    category: 'other',
    priority: priorityFor(task),
    is_completed: cycle.status === 'completed',
    is_repeated: true,
    repeat_rule: 'reminder-linked',
    reminders: [] as string[],
    is_high_risk: false,
  };

  if (existing) return scheduleStore.updateSchedule(id, common);
  return scheduleStore.createSchedule({
    id,
    user_id: task.userId,
    calendar_id: 'personal',
    ...common,
  });
}

export function syncReminderTaskToCalendar(task: ReminderTaskSummary): scheduleStore.Schedule | null {
  if (!task.currentCycle) return null;
  return syncReminderCycleToCalendar(task, task.currentCycle);
}

export function syncReminderTasksToCalendar(tasks: ReminderTaskSummary[]): void {
  for (const task of tasks) syncReminderTaskToCalendar(task);
}

export function deleteReminderSchedules(userId: string, cycles: ReminderCycle[]): void {
  for (const cycle of cycles) {
    const schedule = scheduleStore.getSchedule(reminderScheduleId(cycle.id));
    if (schedule?.user_id === userId) scheduleStore.deleteSchedule(schedule.id);
  }
}
