import {
  claimDelivery,
  getDueReminders,
  markDeliveryFailed,
  markDeliverySent,
} from './reminder-store.js';
import { enqueueUserNotification } from './notification-service.js';

export async function processCycleReminders(log?: (message: string, error?: unknown) => void): Promise<void> {
  const dueReminders = getDueReminders();
  for (const reminder of dueReminders) {
    if (!claimDelivery(reminder.id)) continue;

    try {
      const config = reminder.task.config as any;
      enqueueUserNotification({
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
      log?.(`周期提醒已进入通知队列: ${reminder.task.name} / ${reminder.reminderType}`);
    } catch (error) {
      markDeliveryFailed(reminder.id, error instanceof Error ? error.message : String(error));
      log?.(`周期提醒发送失败: ${reminder.task.name} / ${reminder.reminderType}`, error);
    }
  }
}
