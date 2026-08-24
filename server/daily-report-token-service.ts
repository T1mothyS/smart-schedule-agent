import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

const TOKEN_PREFIX = 'drr_';

export interface DailyReportTokenStatus {
  exists: boolean;
  active: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function hashDailyReportToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function getDailyReportTokenStatus(userId: string): DailyReportTokenStatus {
  const record = db.getDailyReportToken(userId);
  return record ? {
    exists: true,
    active: !record.revoked_at,
    prefix: record.token_prefix,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
    revokedAt: record.revoked_at,
  } : {
    exists: false,
    active: false,
    prefix: null,
    createdAt: null,
    lastUsedAt: null,
    revokedAt: null,
  };
}

export function generateDailyReportToken(userId: string): { token: string; status: DailyReportTokenStatus } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  db.replaceDailyReportToken({
    id: uuidv4(),
    user_id: userId,
    token_hash: hashDailyReportToken(token),
    token_prefix: token.slice(0, 12),
    created_at: now,
    last_used_at: null,
    revoked_at: null,
  });
  return { token, status: getDailyReportTokenStatus(userId) };
}

export function revokeDailyReportToken(userId: string): DailyReportTokenStatus {
  db.revokeDailyReportToken(userId);
  return getDailyReportTokenStatus(userId);
}

export function authenticateDailyReportToken(token: string, usedAt = new Date().toISOString()): { userId: string } | null {
  if (!/^drr_[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const record = db.findActiveDailyReportTokenByHash(hashDailyReportToken(token));
  if (!record) return null;
  db.markDailyReportTokenUsed(record.id, usedAt);
  return { userId: record.user_id };
}
