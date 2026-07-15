import * as activityStore from './activity-store.js';
import * as scheduleStore from './schedule-store.js';

/**
 * 切换日程完成状态，并同步统一完成记录。
 * 这样从日历页取消完成后，行动中心不会继续把该日程视为已完成。
 */
export function toggleScheduleCompletion(id: string, userId: string): scheduleStore.Schedule | null {
  const current = scheduleStore.getSchedule(id);
  if (!current || current.user_id !== userId) return null;

  const schedule = scheduleStore.toggleScheduleComplete(id);
  if (!schedule) return null;

  const activeCompletions = activityStore
    .listCompletions(userId, { sourceType: 'schedule', sourceId: id })
    .filter(item => !item.reopenedAt);

  if (schedule.is_completed) {
    if (activeCompletions.length === 0) {
      activityStore.createCompletion({
        userId,
        sourceType: 'schedule',
        sourceId: id,
        completedAt: schedule.updated_at,
      });
    }
  } else {
    for (const completion of activeCompletions) {
      activityStore.reopenCompletion(completion.id, userId);
    }
  }

  return schedule;
}
