import crypto from 'node:crypto';
import * as db from './db.js';
import * as activityStore from './activity-store.js';
import { toDailyReportView } from './daily-report-service.js';

export const DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES = 200_000;
export const DAILY_REPORT_CLOUD_ACTIVITY_MAX_ITEMS = 100;

export interface DailyReportCloudContextEnvelope {
  version: number;
  context: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DailyReportCloudActivity {
  id: string;
  date: string;
  title: string;
  evidence: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyReportCloudHistoryItem {
  date: string;
  contentHash: string;
  excerpt: string;
  publishedAt: string;
  updatedAt: string;
}

export class DailyReportCloudInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyReportCloudInputError';
  }
}

const SECRET_KEY_PATTERN = /(?:token|password|secret|authorization|api[_-]?key|auth[_-]?code|private[_-]?key|client[_-]?secret)/i;
const SECRET_VALUE_PATTERNS = [
  /drr_[A-Za-z0-9_-]{16,}/i,
  /bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/i,
];
const LOCAL_PATH_PATTERN = /(?:[A-Za-z]:\\|\\\\[^\r\n ]+\\|\/Users\/|\/home\/)/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeJson(value: unknown, path = 'context', depth = 0): void {
  if (depth > 8) throw new DailyReportCloudInputError(`${path} 嵌套层级过深`);
  if (typeof value === 'string') {
    if (value.length > 20_000) throw new DailyReportCloudInputError(`${path} 文本过长`);
    if (SECRET_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
      throw new DailyReportCloudInputError(`${path} 不能包含令牌或私钥`);
    }
    if (LOCAL_PATH_PATTERN.test(value)) throw new DailyReportCloudInputError(`${path} 不能包含本地路径`);
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (value.length > 200) throw new DailyReportCloudInputError(`${path} 数组项目过多`);
    value.forEach((item, index) => assertSafeJson(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isObject(value)) throw new DailyReportCloudInputError(`${path} 不是可保存的 JSON 数据`);
  const keys = Object.keys(value);
  if (keys.length > 100) throw new DailyReportCloudInputError(`${path} 字段过多`);
  for (const key of keys) {
    if (!key || key.length > 100 || SECRET_KEY_PATTERN.test(key)) {
      throw new DailyReportCloudInputError(`${path} 含有不允许的凭据字段`);
    }
    assertSafeJson(value[key], `${path}.${key}`, depth + 1);
  }
}

export function normalizeDailyReportCloudContext(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new DailyReportCloudInputError('context 必须是 JSON 对象');
  assertSafeJson(value);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new DailyReportCloudInputError('context 无法序列化');
  }
  if (Buffer.byteLength(encoded, 'utf8') > DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES) {
    throw new DailyReportCloudInputError(`context 不能超过 ${DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES} 字节`);
  }
  return JSON.parse(encoded) as Record<string, unknown>;
}

function assertSafeText(value: string, path: string): void {
  if (SECRET_VALUE_PATTERNS.some(pattern => pattern.test(value)) || LOCAL_PATH_PATTERN.test(value)) {
    throw new DailyReportCloudInputError(`${path} 不能包含凭据或本地路径`);
  }
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseContext(row: db.DbDailyReportCloudContext | undefined): DailyReportCloudContextEnvelope {
  if (!row) return { version: 0, context: {}, createdAt: null, updatedAt: null };
  try {
    const value = JSON.parse(row.context_json);
    return {
      version: row.version,
      context: normalizeDailyReportCloudContext(value),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    // 历史数据不应阻断日报任务；返回空 Context 并保留版本信息，后续 PUT 可修复。
    return {
      version: row.version,
      context: {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function getDailyReportCloudContext(userId: string): DailyReportCloudContextEnvelope {
  return parseContext(db.getDailyReportCloudContext(userId));
}

export function replaceDailyReportCloudContext(userId: string, value: unknown): DailyReportCloudContextEnvelope {
  const context = normalizeDailyReportCloudContext(value);
  const row = db.upsertDailyReportCloudContext(userId, JSON.stringify(context));
  return parseContext(row);
}

export function listDailyReportCloudActivity(
  userId: string,
  options: { fromDate?: string; toDate?: string; limit?: number } = {},
): DailyReportCloudActivity[] {
  const fromDate = options.fromDate?.trim();
  const toDate = options.toDate?.trim();
  if (fromDate && !validDateKey(fromDate)) throw new DailyReportCloudInputError('fromDate 必须是有效的 YYYY-MM-DD 日期');
  if (toDate && !validDateKey(toDate)) throw new DailyReportCloudInputError('toDate 必须是有效的 YYYY-MM-DD 日期');
  if (fromDate && toDate && fromDate > toDate) throw new DailyReportCloudInputError('fromDate 不能晚于 toDate');
  const parsedLimit = options.limit === undefined ? 100 : Number(options.limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > DAILY_REPORT_CLOUD_ACTIVITY_MAX_ITEMS) {
    throw new DailyReportCloudInputError(`limit 必须是 1 到 ${DAILY_REPORT_CLOUD_ACTIVITY_MAX_ITEMS} 之间的整数`);
  }
  return db.listDailyReportCloudActivity(userId, fromDate, toDate, parsedLimit).map(item => ({
    id: item.id,
    date: item.activity_date,
    title: item.title,
    evidence: item.evidence,
    source: item.source,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }));
}

export function createDailyReportCloudActivity(
  userId: string,
  input: { date?: unknown; title?: unknown; evidence?: unknown; source?: unknown },
): DailyReportCloudActivity {
  const date = String(input.date ?? '').trim();
  const title = String(input.title ?? '').trim();
  const evidence = String(input.evidence ?? '').trim();
  const source = String(input.source ?? 'manual').trim() || 'manual';
  if (!validDateKey(date)) throw new DailyReportCloudInputError('date 必须是有效的 YYYY-MM-DD 日期');
  if (!title || title.length > 200) throw new DailyReportCloudInputError('title 必须为 1 到 200 个字符');
  if (!evidence || evidence.length > 2_000) throw new DailyReportCloudInputError('evidence 必须为 1 到 2000 个字符');
  if (source.length > 100 || /[\u0000-\u001f\u007f]/.test(source)) throw new DailyReportCloudInputError('source 格式不正确');
  assertSafeText(title, 'title');
  assertSafeText(evidence, 'evidence');
  assertSafeText(source, 'source');
  const now = new Date().toISOString();
  const created = db.createDailyReportCloudActivity({
    id: crypto.randomUUID(),
    user_id: userId,
    activity_date: date,
    title,
    evidence,
    source,
    created_at: now,
    updated_at: now,
  });
  return {
    id: created.id,
    date: created.activity_date,
    title: created.title,
    evidence: created.evidence,
    source: created.source,
    createdAt: created.created_at,
    updatedAt: created.updated_at,
  };
}

export function listDailyReportCloudHistory(userId: string, limit = 7): DailyReportCloudHistoryItem[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 7, 1), 30);
  return activityStore.listDailyReports(userId, safeLimit).map(record => {
    const view = toDailyReportView(record, false);
    const excerpt = SECRET_VALUE_PATTERNS.some(pattern => pattern.test(view.excerpt))
      || /(?:[A-Z]:\\|\\\\[^\r\n ]+\\|\/Users\/|\/home\/)/i.test(view.excerpt)
      ? '历史摘要因安全检查不可用'
      : view.excerpt;
    return {
      date: record.reportDate,
      contentHash: record.contentHash,
      excerpt,
      publishedAt: record.publishedAt,
      updatedAt: record.updatedAt,
    };
  });
}

export function isValidDailyReportCloudDate(value: string): boolean {
  return validDateKey(value);
}
