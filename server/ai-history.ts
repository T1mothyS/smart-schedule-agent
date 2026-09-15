import * as dbModule from './db.js';
import * as db from './db.js';

export const AI_SCHEDULE_HISTORY_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export function cleanupAiScheduleHistory(userId?: string): number {
  const cutoff = new Date(Date.now() - AI_SCHEDULE_HISTORY_TTL_MS).toISOString();
  return db.deleteExpiredAiScheduleMessages(cutoff, userId);
}

export function parseHistoryJson(value: string | null): any {
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function toAiScheduleHistoryMessage(message: dbModule.DbAiScheduleMessage) {
  return {
    id: message.id,
    role: message.role,
    type: message.type,
    text: message.content,
    intent: message.intent || undefined,
    scheduleItems: parseHistoryJson(message.schedule_items),
    plan: parseHistoryJson(message.plan),
    knowledgeSources: parseHistoryJson(message.knowledge_sources || null),
    timestamp: message.created_at,
  };
}
