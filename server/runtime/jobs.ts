import { createJobRunner } from './job-runner.js';
import { describeError, describeErrorData, notificationLogCategory } from './logging.js';
import { addLog } from '../log-service.js';
import { processCycleReminders } from '../reminder-service.js';
import { processNotificationQueue, type NotificationLogger } from '../notification-service.js';
import { enqueueDueDailyDigestNotifications, enqueueDueHighPriorityScheduleEmails } from '../notification-scheduler.js';
import * as activityStore from '../activity-store.js';
import * as backupService from '../backup-service.js';
import { pollEmailImports } from '../email-import-service.js';

export function createBackgroundJobs({ isReady, resolveAiImportCredential, cleanupAiScheduleHistory }: {
  isReady: () => boolean;
  resolveAiImportCredential: (userId: string) => { apiKey: string; baseUrl?: string | null; model: string } | null;
  cleanupAiScheduleHistory: () => number;
}) {
  return createJobRunner([
{ name: 'reminders', expression: '* * * * *', run: async () => {
  const tickStartedAt = Date.now();
  if (!isReady()) {
    addLog('warn', 'reminder', '提醒定时任务跳过：数据库尚未初始化', {
      event: 'reminder_cron_skipped',
      dbInitialized: isReady(),
    });
    return;
  }
  const now = new Date();
  try {
    const schedulerLog: NotificationLogger = (message, error, data = {}) => {
      const category = notificationLogCategory(data);
      addLog(error ? 'warn' : 'debug', category, message, error
        ? describeErrorData(error, { event: 'reminder_scheduler_detail', ...data })
        : { event: 'reminder_scheduler_detail', ...data });
    };
    const dailyResult = enqueueDueDailyDigestNotifications(now, schedulerLog);
    const priorityResult = enqueueDueHighPriorityScheduleEmails(now, schedulerLog);
    addLog('info', 'reminder', '提醒扫描完成', {
      event: 'reminder_scheduler_scan_completed',
      now: now.toISOString(),
      durationMs: Date.now() - tickStartedAt,
      daily: dailyResult,
      highPriority: priorityResult,
    });
  } catch (err) {
    addLog('error', 'reminder', '提醒调度入队失败', describeErrorData(err, {
      event: 'reminder_scheduler_scan_failed',
      now: now.toISOString(),
      durationMs: Date.now() - tickStartedAt,
    }));
  }

  const cycle = processCycleReminders((message, error) => {
    if (error) addLog('error', 'reminder', message, describeErrorData(error, { event: 'cycle_reminder_error' }));
    else addLog('debug', 'reminder', message, { event: 'cycle_reminder_queue' });
  }).catch(error => {
    addLog('error', 'reminder', '周期提醒检查失败', describeErrorData(error, { event: 'cycle_reminder_scan_failed' }));
  });

  const queue = processNotificationQueue((message, error, data = {}) => {
    const category = notificationLogCategory(data);
    if (error) addLog('error', category, message, describeErrorData(error, data));
    else addLog('debug', category, message, data);
  }).then(queueResult => {
    addLog('debug', 'reminder', '通知队列本次统计', {
      event: 'notification_queue_tick_result',
      ...queueResult,
      durationMs: Date.now() - tickStartedAt,
    });
  }).catch(error => addLog('error', 'reminder', '通知队列处理失败', describeErrorData(error, {
    event: 'notification_queue_processing_failed',
    durationMs: Date.now() - tickStartedAt,
  })));

  try {
    const expiredImports = activityStore.expireAiImports();
    if (expiredImports > 0) addLog('info', 'ai', '清理 AI 助手过期草稿', {
      event: 'ai_imports_expired',
      count: expiredImports,
    });
  } catch (error) {
    addLog('error', 'ai', '清理 AI 助手过期草稿失败', describeErrorData(error, {
      event: 'ai_imports_expire_failed',
    }));
  }
  await Promise.all([cycle, queue]);
}},

{ name: 'daily-backup', expression: '30 3 * * *', timezone: process.env.APP_TIMEZONE || 'Asia/Shanghai', run: async () => {
  if (!isReady() || !process.env.BACKUP_ENCRYPTION_KEY) return;
  try {
    const backup = backupService.createSystemSnapshot(true);
    const oss = await backupService.uploadPendingSystemSnapshots();
    addLog('info', 'system', '每日系统备份完成: ' + backup.filename, { size: backup.size, oss });
  } catch (error: any) {
    addLog('error', 'system', '每日系统备份失败: ' + (error?.message || error));
  }
}},

{ name: 'backup-upload', expression: '*/30 * * * *', run: async () => {
  if (!isReady()) return;
  const result = await backupService.uploadPendingSystemSnapshots();
  if (result.uploaded || result.failed) {
    addLog(result.failed ? 'warn' : 'info', 'system', 'OSS 备份重试完成', result);
  }
}},

{ name: 'email-import', expression: '*/5 * * * *', run: async () => {
  if (!isReady() || !process.env.IMAP_PASS) return;
  await pollEmailImports({
    resolveCredential: resolveAiImportCredential,
    log: (message, error) => error
      ? addLog('error', 'ai', message, { error: describeError(error) })
      : addLog('info', 'ai', message),
  }).catch(error => addLog('error', 'ai', '邮箱导入调度失败: ' + (error?.message || error)));
}},

// 每小时逐条清理超过 3 天的 AI 助手历史，避免只在用户打开页面时才清理。
{ name: 'ai-history', expression: '0 * * * *', run: () => {
  if (!isReady()) return;
  try {
    const deleted = cleanupAiScheduleHistory();
    if (deleted > 0) addLog('info', 'ai', `清理 AI 助手过期历史: ${deleted} 条`);
  } catch (error: any) {
    addLog('error', 'ai', '清理 AI 助手过期历史失败', { error: error?.message || String(error) });
  }
}},
  ], (name, error) => addLog('error', 'system', '后台任务失败', describeErrorData(error, { job: name })));
}
