import {
  claimDelivery,
  getDueReminders,
  markDeliveryFailed,
  markDeliverySent,
} from './reminder-store.js';
import { enqueueUserNotificationDetailed, type NotificationLogger } from './notification-service.js';

export async function processCycleReminders(log?: NotificationLogger): Promise<void> {
  const dueReminders = getDueReminders();
  for (const reminder of dueReminders) {
    if (!claimDelivery(reminder.id)) continue;

    try {
      const config = reminder.task.config as any;
      const notifications = enqueueUserNotificationDetailed({
        userId: reminder.task.userId,
        sourceType: 'reminder',
        sourceId: reminder.task.id,
        instanceId: reminder.cycle.id,
        kind: reminder.reminderType,
        title: `【事务提醒】${reminder.task.name}`,
        body: `截止日期：${reminder.cycle.dueDate}\n${config.actionGuide || '请完成本周期事务并登记。'}`,
        dedupePrefix: `cycle:${reminder.cycle.id}:${reminder.reminderType}:${reminder.scheduledDate}`,
      });
      markDeliverySent(reminder.id);
      log?.('周期提醒已进入通知队列', undefined, {
        event: 'cycle_reminder_enqueue',
        userId: reminder.task.userId,
        taskId: reminder.task.id,
        cycleId: reminder.cycle.id,
        reminderType: reminder.reminderType,
        scheduledDate: reminder.scheduledDate,
        queuedCount: notifications.length,
        createdCount: notifications.filter(item => item.created).length,
        deduplicatedCount: notifications.filter(item => !item.created).length,
        notificationIds: notifications.map(item => item.notification.id),
      });
    } catch (error) {
      markDeliveryFailed(reminder.id, error instanceof Error ? error.message : String(error));
      log?.('周期提醒入队失败', error, {
        event: 'cycle_reminder_enqueue_failed',
        userId: reminder.task.userId,
        taskId: reminder.task.id,
        cycleId: reminder.cycle.id,
        reminderType: reminder.reminderType,
        scheduledDate: reminder.scheduledDate,
      });
    }
  }
}
