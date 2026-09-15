import { queryOne, run } from '../connection.js';
import type { DbDailyReportToken } from '../types.js';

export function getDailyReportToken(userId: string): DbDailyReportToken | undefined {
  return queryOne<DbDailyReportToken>('SELECT * FROM daily_report_tokens WHERE user_id = ?', [userId]);
}

export function replaceDailyReportToken(token: DbDailyReportToken): DbDailyReportToken {
  run('DELETE FROM daily_report_tokens WHERE user_id = ?', [token.user_id]);
  run(
    `INSERT INTO daily_report_tokens
     (id, user_id, token_hash, token_prefix, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [token.id, token.user_id, token.token_hash, token.token_prefix, token.created_at, token.last_used_at, token.revoked_at],
  );
  return token;
}

export function revokeDailyReportToken(userId: string, revokedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE daily_report_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    [revokedAt, userId],
  ).changes > 0;
}

export function findActiveDailyReportTokenByHash(tokenHash: string): DbDailyReportToken | undefined {
  return queryOne<DbDailyReportToken>(
    `SELECT t.* FROM daily_report_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
    [tokenHash],
  );
}

export function markDailyReportTokenUsed(id: string, usedAt = new Date().toISOString()): void {
  run('UPDATE daily_report_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL', [usedAt, id]);
}
