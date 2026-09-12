import crypto from 'node:crypto';
import * as db from './db.js';
import type { DailyReportSource } from './activity-store.js';

export const DAILY_REPORT_DELIVERY_SOURCES: readonly DailyReportSource[] = ['local', 'cloud'];

export interface DailyReportDeliveryPolicy {
  sources: DailyReportSource[];
  updatedAt: string | null;
}

function canonicalSources(value: unknown, rejectInvalid = true): DailyReportSource[] {
  if (!Array.isArray(value)) {
    if (rejectInvalid) throw new Error('sources 必须是 local/cloud 的数组');
    return ['local'];
  }
  const values = new Set<DailyReportSource>();
  for (const item of value) {
    if (item !== 'local' && item !== 'cloud') {
      if (rejectInvalid) throw new Error('sources 只能包含 local 或 cloud');
      continue;
    }
    values.add(item);
  }
  return DAILY_REPORT_DELIVERY_SOURCES.filter(source => values.has(source));
}

function storedSources(value: string | null | undefined): DailyReportSource[] {
  if (!value) return ['local'];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(item => item !== 'local' && item !== 'cloud')) return ['local'];
    return canonicalSources(parsed);
  } catch {
    return ['local'];
  }
}

export function normalizeDailyReportDeliverySources(value: unknown): DailyReportSource[] {
  return canonicalSources(value, true);
}

export function getDailyReportDeliveryPolicy(userId: string): DailyReportDeliveryPolicy {
  const reminder = db.getReminder(userId);
  return {
    sources: storedSources(reminder?.daily_report_delivery_sources),
    updatedAt: reminder?.updated_at || null,
  };
}

export function setDailyReportDeliveryPolicy(userId: string, value: unknown): DailyReportDeliveryPolicy {
  const sources = normalizeDailyReportDeliverySources(value);
  const now = new Date().toISOString();
  const current = db.getReminder(userId);
  const saved = db.upsertReminder({
    ...(current || {
      id: crypto.randomUUID(),
      user_id: userId,
      enabled: 0,
      hour: 8,
      minute: 0,
      created_at: now,
    }),
    daily_report_delivery_sources: JSON.stringify(sources),
    updated_at: now,
  });
  return {
    sources: storedSources(saved.daily_report_delivery_sources),
    updatedAt: saved.updated_at || now,
  };
}
