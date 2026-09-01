import crypto from 'node:crypto';
import * as db from './db.js';
import * as activityStore from './activity-store.js';
import { enqueueUserEmailNotificationDetailed } from './notification-service.js';
import { renderMarkdown } from './markdown-renderer.js';
import { addLog } from './log-service.js';

export const DAILY_REPORT_SOURCE_TYPE = 'daily_report';
export const DAILY_REPORT_KIND = 'daily_report';
export const MAX_DAILY_REPORT_BYTES = 800_000;

export type DailyReportPublishStatus = 'CREATED' | 'UNCHANGED' | 'UPDATED';
export type DailyReportEmailStatus = 'DISABLED' | 'QUEUED' | 'SENT' | 'FAILED';
export type DailyReportPublishEmailStatus = 'QUEUED' | 'DISABLED' | 'ALREADY_QUEUED' | 'ALREADY_SENT' | 'FAILED';

export interface DailyReportView {
  id: string;
  date: string;
  markdown?: string;
  html?: string;
  excerpt: string;
  contentHash: string;
  publishedAt: string;
  updatedAt: string;
  emailStatus: DailyReportEmailStatus;
  emailNotificationId: string | null;
}

export interface PublishDailyReportResult {
  reportStatus: DailyReportPublishStatus;
  emailStatus: DailyReportPublishEmailStatus;
  report: DailyReportView;
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateDailyReportInput(reportDate: string, markdown: unknown): asserts markdown is string {
  if (!isValidDateKey(reportDate)) throw new Error('date 必须是有效的 YYYY-MM-DD 日期');
  if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('日报正文不能为空');
  if (Buffer.byteLength(markdown, 'utf8') > MAX_DAILY_REPORT_BYTES) {
    throw new Error(`日报正文不能超过 ${MAX_DAILY_REPORT_BYTES} 字节`);
  }
}

export function hashDailyReport(markdown: string): string {
  return crypto.createHash('sha256').update(markdown, 'utf8').digest('hex');
}

function emailStatus(record: activityStore.DailyReportRecord): DailyReportEmailStatus {
  if (!record.emailNotificationId) return 'DISABLED';
  const notification = activityStore.getNotification(record.emailNotificationId, record.userId);
  if (!notification) return 'FAILED';
  if (notification.status === 'sent') return 'SENT';
  if (notification.status === 'failed') return 'FAILED';
  return 'QUEUED';
}

function publishEmailStatus(status: DailyReportEmailStatus, created: boolean): DailyReportPublishEmailStatus {
  if (created && status === 'QUEUED') return 'QUEUED';
  if (status === 'QUEUED') return 'ALREADY_QUEUED';
  if (status === 'SENT') return 'ALREADY_SENT';
  return status;
}

interface QueuedDailyReportEmail {
  record: activityStore.DailyReportRecord;
  notification: activityStore.NotificationDelivery;
  created: boolean;
}

function enqueueDailyReportEmail(record: activityStore.DailyReportRecord, dedupeKey: string): QueuedDailyReportEmail {
  const queued = enqueueUserEmailNotificationDetailed({
    userId: record.userId,
    sourceType: DAILY_REPORT_SOURCE_TYPE,
    sourceId: record.reportDate,
    kind: DAILY_REPORT_KIND,
    title: `个人情报日报 · ${record.reportDate}`,
    // 保存正文快照，避免用户随后更新网页版本时改变已经入队的邮件内容。
    body: record.markdown,
    dedupeKey,
    maxAttempts: 1,
  });
  const attachedRecord = activityStore.attachDailyReportNotification(record.id, record.userId, queued.notification.id) || record;
  return { record: attachedRecord, notification: queued.notification, created: queued.created };
}

export function queueDailyReportEmail(userId: string, reportDate: string, options: { manual?: boolean } = {}): DailyReportView | null {
  const record = activityStore.getDailyReport(userId, reportDate);
  if (!record) return null;
  const dedupeKey = options.manual
    ? `daily-report:${userId}:${reportDate}:manual:${crypto.randomUUID()}:email`
    : `daily-report:${userId}:${reportDate}:content:${record.contentHash}:email`;
  const queued = enqueueDailyReportEmail(record, dedupeKey);
  return toDailyReportView(queued.record);
}

function excerpt(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>|`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function toDailyReportView(record: activityStore.DailyReportRecord, includeContent = true): DailyReportView {
  return {
    id: record.id,
    date: record.reportDate,
    ...(includeContent ? { markdown: record.markdown, html: renderMarkdown(record.markdown) } : {}),
    excerpt: excerpt(record.markdown),
    contentHash: record.contentHash,
    publishedAt: record.publishedAt,
    updatedAt: record.updatedAt,
    emailStatus: emailStatus(record),
    emailNotificationId: record.emailNotificationId,
  };
}

export function listDailyReportViews(userId: string, limit = 100): DailyReportView[] {
  return activityStore.listDailyReports(userId, limit).map(record => toDailyReportView(record, false));
}

export function getDailyReportView(userId: string, reportDate: string): DailyReportView | null {
  const record = activityStore.getDailyReport(userId, reportDate);
  return record ? toDailyReportView(record) : null;
}

export function publishDailyReport(userId: string, reportDate: string, markdown: string): PublishDailyReportResult {
  validateDailyReportInput(reportDate, markdown);
  const contentHash = hashDailyReport(markdown);
  const existing = activityStore.getDailyReport(userId, reportDate);
  let record: activityStore.DailyReportRecord;
  let reportStatus: DailyReportPublishStatus;

  if (existing && existing.contentHash === contentHash) {
    record = existing;
    reportStatus = 'UNCHANGED';
  } else if (existing) {
    record = activityStore.updateDailyReport(existing.id, userId, markdown, contentHash) || existing;
    reportStatus = 'UPDATED';
  } else {
    record = activityStore.createDailyReport({ userId, reportDate, markdown, contentHash });
    reportStatus = 'CREATED';
  }

  let currentEmailStatus = emailStatus(record);
  let queuedNotificationCreated = false;
  if ((reportStatus === 'CREATED' || reportStatus === 'UPDATED') && db.getReminder(userId)?.report_email_enabled === 1) {
    const queued = enqueueDailyReportEmail(record, `daily-report:${userId}:${reportDate}:content:${contentHash}:email`);
    record = queued.record;
    queuedNotificationCreated = queued.created;
    currentEmailStatus = queued.created ? 'QUEUED' : emailStatus(record);
  } else if (reportStatus === 'CREATED' || reportStatus === 'UPDATED') {
    currentEmailStatus = emailStatus(record);
  }

  addLog('info', 'mail', '日报发布状态已记录', {
    event: 'daily_report_published',
    userId,
    date: reportDate,
    contentHash,
    reportStatus,
    emailStatus: currentEmailStatus,
  });
  return {
    reportStatus,
    emailStatus: publishEmailStatus(currentEmailStatus, queuedNotificationCreated),
    report: toDailyReportView(record),
  };
}
