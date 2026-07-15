import {
  claimDelivery,
  getDueReminders,
  markDeliveryFailed,
  markDeliverySent,
} from './reminder-store.js';
import * as db from './db.js';
import { sendCycleReminderEmail } from './email-service.js';

export async function processCycleReminders(log?: (message: string, error?: unknown) => void): Promise<void> {
  const dueReminders = getDueReminders();
  for (const reminder of dueReminders) {
    if (!claimDelivery(reminder.id)) continue;

    try {
      await sendCycleReminderEmail({
        task: reminder.task,
        cycle: reminder.cycle,
        reminderType: reminder.reminderType,
        scheduledDate: reminder.scheduledDate,
      });
      markDeliverySent(reminder.id);
      log?.(`周期提醒发送成功: ${reminder.task.name} / ${reminder.reminderType}`);
    } catch (error) {
      markDeliveryFailed(reminder.id, error instanceof Error ? error.message : String(error));
      log?.(`周期提醒发送失败: ${reminder.task.name} / ${reminder.reminderType}`, error);
    }
  }
}
