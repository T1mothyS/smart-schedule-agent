import crypto from 'node:crypto';
import * as db from './db.js';
import * as activityStore from './activity-store.js';
import { enqueueUserEmailNotificationDetailed } from './notification-service.js';
import { renderMarkdown } from './markdown-renderer.js';
import { addLog } from './log-service.js';
import { dailyReportMediaPath, localizeDailyDigestImages, type DailyReportMediaOptions } from './daily-report-media-service.js';
import { parseDailyDigestMarkdown, selectDailyDigestFeaturedStory } from './daily-digest-template.js';
import { getDailyReportDeliveryPolicy } from './daily-report-delivery-policy.js';

export const DAILY_REPORT_SOURCE_TYPE = 'daily_report';
export const DAILY_REPORT_KIND = 'daily_report';
export const MAX_DAILY_REPORT_BYTES = 800_000;

export type DailyReportPublishStatus = 'CREATED' | 'UNCHANGED' | 'UPDATED';
export type DailyReportEmailStatus = 'DISABLED' | 'QUEUED' | 'SENT' | 'FAILED';
export type DailyReportPublishEmailStatus = 'QUEUED' | 'DISABLED' | 'ALREADY_QUEUED' | 'ALREADY_SENT' | 'FAILED';
export type DailyReportViewDeliveryStatus = 'RECEIVED' | 'CANDIDATE';

export interface DailyReportView {
  id: string;
  date: string;
  headline: string | null;
  heroImageUrl: string | null;
  markdown?: string;
  html?: string;
  excerpt: string;
  contentHash: string;
  publishedAt: string;
  updatedAt: string;
  source: activityStore.DailyReportSource;
  deliveryStatus: DailyReportViewDeliveryStatus;
  emailStatus: DailyReportEmailStatus;
  emailNotificationId: string | null;
}

export interface PublishDailyReportResult {
  status: 'PUBLISHED';
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

export function queueDailyReportEmail(
  userId: string,
  reportDate: string,
  options: { manual?: boolean; source?: activityStore.DailyReportSource } = {},
): DailyReportView | null {
  const record = activityStore.getDailyReport(userId, reportDate, options.source);
  if (!record) return null;
  const dedupeKey = options.manual
    ? `daily-report:${userId}:${reportDate}:${record.source}:manual:${crypto.randomUUID()}:email`
    : `daily-report:${userId}:${reportDate}:${record.source}:content:${record.contentHash}:email`;
  const queued = enqueueDailyReportEmail(record, dedupeKey);
  return toDailyReportView(queued.record);
}

const PREVIEW_FALLBACK = '今日主要新闻概览';

function cleanPreviewText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPreviewStructure(raw: string, cleaned: string): boolean {
  if (!cleaned) return true;
  if (/^\s*\|/.test(raw) || /^\s*:?-{3,}:?\s*(?:\||$)/.test(raw)) return true;
  if (/^(?:Daily Digest|日期[:：]|今日主题[:：]|Today at a Glance|Lead Story|Category Digest|Mail Briefing|Mail Tasks|Worth Your Time|Footer)/i.test(cleaned)) return true;
  return false;
}

function legacyExcerpt(markdown: string): string {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '\n');
  const candidate = withoutCode
    .split(/\r?\n/)
    .map(line => ({ raw: line, cleaned: cleanPreviewText(line) }))
    .find(({ raw, cleaned }) => !isPreviewStructure(raw, cleaned));
  return (candidate?.cleaned || PREVIEW_FALLBACK).slice(0, 240);
}

function reportPresentation(markdown: string): { headline: string | null; heroImageUrl: string | null; excerpt: string } {
  const digest = parseDailyDigestMarkdown(markdown);
  if (digest) {
    const featured = selectDailyDigestFeaturedStory(digest, { requireImage: false });
    const overview = digest.atAGlance.slice(0, 3).join('；');
    return {
      headline: featured?.headline || null,
      heroImageUrl: featured?.imageUrl ? dailyReportMediaPath(featured.imageUrl) : null,
      excerpt: `${PREVIEW_FALLBACK}${featured?.summary ? `：${featured.summary}` : overview ? `：${overview}` : ''}`.slice(0, 240),
    };
  }
  return { headline: null, heroImageUrl: null, excerpt: legacyExcerpt(markdown) };
}

export function toDailyReportView(record: activityStore.DailyReportRecord, includeContent = true): DailyReportView {
  const presentation = reportPresentation(record.markdown);
  return {
    id: record.id,
    date: record.reportDate,
    headline: presentation.headline,
    heroImageUrl: presentation.heroImageUrl,
    ...(includeContent ? { markdown: record.markdown, html: renderMarkdown(record.markdown) } : {}),
    excerpt: presentation.excerpt,
    contentHash: record.contentHash,
    publishedAt: record.publishedAt,
    updatedAt: record.updatedAt,
    source: record.source || 'local',
    deliveryStatus: record.deliveryStatus === 'candidate' ? 'CANDIDATE' : 'RECEIVED',
    emailStatus: emailStatus(record),
    emailNotificationId: record.emailNotificationId,
  };
}

export function listDailyReportViews(userId: string, limit = 100, view: 'received' | 'candidates' = 'received'): DailyReportView[] {
  const records = view === 'received'
    ? activityStore.listDailyReports(userId, limit)
    : activityStore.listDailyReportsPage(userId, limit, 0, 'candidates').reports;
  return records.map(record => toDailyReportView(record, false));
}

export function listDailyReportViewsPage(
  userId: string,
  limit = 100,
  offset = 0,
  view: 'received' | 'candidates' = 'received',
): { reports: DailyReportView[]; total: number } {
  const result = activityStore.listDailyReportsPage(userId, limit, offset, view);
  return { reports: result.reports.map(record => toDailyReportView(record, false)), total: result.total };
}

export function getDailyReportView(
  userId: string,
  reportDate: string,
  source?: activityStore.DailyReportSource,
): DailyReportView | null {
  const record = activityStore.getDailyReport(userId, reportDate, source);
  return record ? toDailyReportView(record) : null;
}

export function getDailyReportCandidateView(userId: string, reportDate: string, source: activityStore.DailyReportSource): DailyReportView | null {
  const record = activityStore.getDailyReportBySourceAndStatus(userId, reportDate, source, 'candidate');
  return record ? toDailyReportView(record) : null;
}

export function getDailyReportViewsForDate(userId: string, reportDate: string): { report: DailyReportView | null; reports: DailyReportView[] } {
  const records = activityStore.listDailyReportsForDate(userId, reportDate);
  const reports = records.map(record => toDailyReportView(record, false));
  const preferred = records.find(record => record.deliveryStatus === 'received') || records[0] || null;
  return { report: preferred ? toDailyReportView(preferred) : null, reports };
}

export async function publishDailyReport(
  userId: string,
  reportDate: string,
  markdown: string,
  mediaOptions: DailyReportMediaOptions & { source?: activityStore.DailyReportSource } = {},
): Promise<PublishDailyReportResult> {
  validateDailyReportInput(reportDate, markdown);
  const { source: sourceOverride, ...localizationOptions } = mediaOptions;
  const source = sourceOverride || 'local';
  if (source !== 'local' && source !== 'cloud') throw new Error('日报来源不受支持');
  const localizedMarkdown = await localizeDailyDigestImages(markdown, localizationOptions);
  validateDailyReportInput(reportDate, localizedMarkdown);
  const contentHash = hashDailyReport(localizedMarkdown);
  const selectedSources = getDailyReportDeliveryPolicy(userId).sources;
  const shouldReceive = selectedSources.includes(source);
  const existingExact = activityStore.getDailyReportCandidate(userId, reportDate, source, contentHash);
  const existingLatest = activityStore.getLatestDailyReportCandidate(userId, reportDate, source);
  let record: activityStore.DailyReportRecord;
  let reportStatus: DailyReportPublishStatus;
  let promoted = false;

  if (existingExact) {
    if (shouldReceive && existingExact.deliveryStatus === 'candidate') {
      record = activityStore.promoteDailyReportCandidate(existingExact.id, userId) || existingExact;
      promoted = record.deliveryStatus === 'received';
      reportStatus = promoted ? 'UPDATED' : 'UNCHANGED';
    } else {
      record = existingExact;
      reportStatus = 'UNCHANGED';
    }
  } else {
    record = activityStore.createDailyReport({
      userId,
      reportDate,
      source,
      deliveryStatus: shouldReceive ? 'received' : 'candidate',
      markdown: localizedMarkdown,
      contentHash,
    });
    reportStatus = existingLatest ? 'UPDATED' : 'CREATED';
  }

  let currentEmailStatus = emailStatus(record);
  let queuedNotificationCreated = false;
  const shouldQueueEmail = record.deliveryStatus === 'received'
    && (reportStatus === 'CREATED' || reportStatus === 'UPDATED' || promoted)
    && db.getReminder(userId)?.report_email_enabled === 1;
  if (shouldQueueEmail) {
    const queued = enqueueDailyReportEmail(record, `daily-report:${userId}:${reportDate}:${source}:content:${contentHash}:email`);
    record = queued.record;
    queuedNotificationCreated = queued.created;
    currentEmailStatus = queued.created ? 'QUEUED' : emailStatus(record);
  } else if (reportStatus === 'CREATED' || reportStatus === 'UPDATED' || promoted) {
    currentEmailStatus = emailStatus(record);
  }

  addLog('info', 'daily-report', '日报发布状态已记录', {
    event: 'daily_report_published',
    userId,
    date: reportDate,
    source,
    deliveryStatus: record.deliveryStatus,
    contentHash,
    reportStatus,
    emailStatus: currentEmailStatus,
  });
  return {
    status: 'PUBLISHED',
    reportStatus,
    emailStatus: publishEmailStatus(currentEmailStatus, queuedNotificationCreated),
    report: toDailyReportView(record),
  };
}
