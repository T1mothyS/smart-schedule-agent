import * as activityStore from './activity-store.js';
import * as db from './db.js';
import {
  sendDailyReminderEmail,
  sendQueuedNotificationEmail,
  summarizeEmailSendResult,
  type EmailSendResult,
} from './email-service.js';

export type NotificationLogger = (
  message: string,
  error?: unknown,
  data?: Record<string, unknown>,
) => void;

function timeInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
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
  return enqueueUserNotificationDetailed(input).map(result => result.notification);
}

export function enqueueUserNotificationDetailed(input: {
  userId: string;
  sourceType: string;
  sourceId: string;
  instanceId?: string | null;
  kind: string;
  title: string;
  body: string;
  scheduledAt?: string;
  dedupePrefix: string;
  log?: NotificationLogger;
}): activityStore.EnqueueNotificationResult[] {
  const preference = db.getReminder(input.userId);
  const scheduledAt = quietAdjustedDate(input.userId, input.scheduledAt || new Date().toISOString());
  const channels: activityStore.NotificationChannel[] = [];
  if (preference?.email_enabled !== 0) channels.push('email');
  if (preference?.in_app_enabled !== 0) channels.push('in_app');
  if (preference?.browser_enabled !== 0) channels.push('browser');
  const results = channels.map(channel => activityStore.enqueueNotificationDetailed({
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
  for (const result of results) {
    input.log?.(
      result.created ? '通知已创建并进入通知队列' : '通知入队命中已有记录',
      undefined,
      notificationLogData(result.notification, {
        event: result.created ? 'notification_created' : 'notification_deduplicated',
        created: result.created,
      }),
    );
  }
  return results;
}

/**
 * 入队一条只发送邮件的通知。
 *
 * 该入口刻意不读取提醒渠道开关，也不调整免打扰时间，供固定规则的高优先级邮件使用。
 * 仍然写入同一张持久化通知表，因此继续复用队列的发送、重试和状态记录能力。
 */
export function enqueueUserEmailNotification(input: {
  userId: string;
  sourceType: string;
  sourceId: string;
  instanceId?: string | null;
  kind: string;
  title: string;
  body: string;
  scheduledAt?: string;
  dedupeKey: string;
}): activityStore.NotificationDelivery {
  return enqueueUserEmailNotificationDetailed(input).notification;
}

export function enqueueUserEmailNotificationDetailed(input: {
  userId: string;
  sourceType: string;
  sourceId: string;
  instanceId?: string | null;
  kind: string;
  title: string;
  body: string;
  scheduledAt?: string;
  dedupeKey: string;
  log?: NotificationLogger;
}): activityStore.EnqueueNotificationResult {
  const result = activityStore.enqueueNotificationDetailed({
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    instanceId: input.instanceId,
    channel: 'email',
    kind: input.kind,
    title: input.title,
    body: input.body,
    scheduledAt: input.scheduledAt || new Date().toISOString(),
    dedupeKey: input.dedupeKey,
  });
  input.log?.(
    result.created ? '邮件通知已创建并进入通知队列' : '邮件通知入队命中已有记录',
    undefined,
    notificationLogData(result.notification, {
      event: result.created ? 'notification_created' : 'notification_deduplicated',
      created: result.created,
    }),
  );
  return result;
}

function notificationLogData(item: activityStore.NotificationDelivery, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    notificationId: item.id,
    userId: item.userId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    kind: item.kind,
    channel: item.channel,
    scheduledAt: item.scheduledAt,
    status: item.status,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    nextRetryAt: item.nextRetryAt,
    ...extra,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || !error || !('code' in error)) return null;
  const code = String((error as { code?: unknown }).code || '').trim();
  return code || null;
}

function emailResultFromError(error: unknown): EmailSendResult | null {
  if (!error || typeof error !== 'object' || !('emailResult' in error)) return null;
  const result = (error as { emailResult?: unknown }).emailResult;
  return result && typeof result === 'object' ? result as EmailSendResult : null;
}

export interface NotificationQueueResult {
  scanned: number;
  claimed: number;
  claimSkipped: number;
  sent: number;
  failed: number;
}

export async function processNotificationQueue(log?: NotificationLogger): Promise<NotificationQueueResult> {
  const startedAt = Date.now();
  const dueItems = activityStore.listDueNotifications();
  const result: NotificationQueueResult = {
    scanned: dueItems.length,
    claimed: 0,
    claimSkipped: 0,
    sent: 0,
    failed: 0,
  };
  if (dueItems.length > 0) {
    log?.('通知队列扫描到待处理项', undefined, {
      event: 'notification_queue_scan_started',
      dueCount: dueItems.length,
    });
  }

  for (const item of dueItems) {
    if (!activityStore.claimNotification(item.id)) {
      result.claimSkipped += 1;
      log?.('通知未能领取，可能已被其他任务处理', undefined, notificationLogData(item, {
        event: 'notification_claim_skipped',
      }));
      continue;
    }
    result.claimed += 1;
    const claimedItem = activityStore.getNotification(item.id) || item;
    log?.('通知已领取，准备处理', undefined, notificationLogData(claimedItem, {
      event: 'notification_claimed',
      attemptsAfterClaim: claimedItem.attempts,
    }));
    try {
      if (item.channel === 'email') {
        const email = db.getReminderEmail(item.userId);
        log?.('邮件发送开始', undefined, notificationLogData(claimedItem, {
          event: 'email_send_started',
          recipient: email || null,
        }));
        if (!email) throw new Error('用户没有可用的提醒邮箱');
        const emailStartedAt = Date.now();
        const sendResult = item.kind === 'daily_digest'
          ? await sendDailyReminderEmail(email, item.userId, item.sourceId)
          : await sendQueuedNotificationEmail(email, item.title, item.body);
        log?.('SMTP 已接受收件人', undefined, notificationLogData(claimedItem, {
          event: 'email_smtp_accepted',
          recipient: email,
          durationMs: Date.now() - emailStartedAt,
          ...summarizeEmailSendResult(sendResult),
        }));
      } else {
        log?.('非邮件通知直接进入已发送状态', undefined, notificationLogData(claimedItem, {
          event: 'non_email_notification_marked_sent',
        }));
      }
      activityStore.markNotificationSent(item.id);
      result.sent += 1;
      const sentItem = activityStore.getNotification(item.id) || claimedItem;
      log?.('通知状态已标记为 sent', undefined, notificationLogData(sentItem, {
        event: 'notification_sent',
        sentAt: sentItem.sentAt,
        durationMs: Date.now() - startedAt,
      }));
    } catch (error) {
      const failureMessage = errorMessage(error);
      const failureCode = errorCode(error);
      const errorEmailResult = emailResultFromError(error);
      activityStore.markNotificationFailed(item.id, failureMessage);
      result.failed += 1;
      const failedItem = activityStore.getNotification(item.id) || claimedItem;
      if (errorEmailResult) {
        log?.('SMTP 未接受收件人，邮件进入失败重试', error, notificationLogData(failedItem, {
          event: 'email_smtp_rejected',
          ...summarizeEmailSendResult(errorEmailResult),
        }));
      }
      log?.('通知发送失败，已记录重试状态', error, notificationLogData(failedItem, {
        event: 'notification_failed',
        lastError: failureMessage,
        ...(failureCode ? { errorCode: failureCode } : {}),
        nextRetryAt: failedItem.nextRetryAt,
        statusAfterFailure: failedItem.status,
        retryScheduled: failedItem.attempts < failedItem.maxAttempts,
        durationMs: Date.now() - startedAt,
        ...(errorEmailResult ? summarizeEmailSendResult(errorEmailResult) : {}),
      }));
    }
  }

  if (dueItems.length > 0 || result.failed > 0) {
    log?.('通知队列处理完成', undefined, {
      event: 'notification_queue_completed',
      ...result,
      durationMs: Date.now() - startedAt,
    });
  }
  return result;
}
