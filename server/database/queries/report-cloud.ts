import { queryAll, queryOne, run } from '../connection.js';
import type { DbDailyReportCloudContext, DbDailyReportCloudActivity, DbDailyReportMediaBatchStatus, DbDailyReportMediaBatch, DbDailyReportMediaAsset } from '../types.js';

export function getDailyReportCloudContext(userId: string): DbDailyReportCloudContext | undefined {
  return queryOne<DbDailyReportCloudContext>(
    'SELECT * FROM daily_report_cloud_contexts WHERE user_id = ?',
    [userId],
  );
}

export function upsertDailyReportCloudContext(
  userId: string,
  contextJson: string,
  now = new Date().toISOString(),
): DbDailyReportCloudContext {
  const existing = getDailyReportCloudContext(userId);
  const version = existing ? existing.version + 1 : 1;
  if (existing) {
    run(
      'UPDATE daily_report_cloud_contexts SET version = ?, context_json = ?, updated_at = ? WHERE user_id = ?',
      [version, contextJson, now, userId],
    );
  } else {
    run(
      `INSERT INTO daily_report_cloud_contexts
       (user_id, version, context_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, version, contextJson, now, now],
    );
  }
  return getDailyReportCloudContext(userId)!;
}

export function listDailyReportCloudActivity(
  userId: string,
  fromDate?: string,
  toDate?: string,
  limit = 100,
): DbDailyReportCloudActivity[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  const clauses = ['user_id = ?'];
  const params: any[] = [userId];
  if (fromDate) {
    clauses.push('activity_date >= ?');
    params.push(fromDate);
  }
  if (toDate) {
    clauses.push('activity_date <= ?');
    params.push(toDate);
  }
  params.push(safeLimit);
  return queryAll<DbDailyReportCloudActivity>(
    `SELECT * FROM daily_report_cloud_activity
     WHERE ${clauses.join(' AND ')}
     ORDER BY activity_date DESC, updated_at DESC
     LIMIT ?`,
    params,
  );
}

export function createDailyReportCloudActivity(input: DbDailyReportCloudActivity): DbDailyReportCloudActivity {
  run(
    `INSERT INTO daily_report_cloud_activity
     (id, user_id, activity_date, title, evidence, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.user_id, input.activity_date, input.title, input.evidence, input.source, input.created_at, input.updated_at],
  );
  return input;
}

export function createDailyReportMediaBatch(input: DbDailyReportMediaBatch): DbDailyReportMediaBatch {
  run(
    `INSERT INTO daily_report_media_batches
     (id, user_id, report_date, run_id, status, created_at, updated_at, expires_at, committed_at, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.user_id,
      input.report_date,
      input.run_id,
      input.status,
      input.created_at,
      input.updated_at,
      input.expires_at,
      input.committed_at,
      input.failure_reason,
    ],
  );
  return input;
}

export function getDailyReportMediaBatch(id: string): DbDailyReportMediaBatch | undefined {
  return queryOne<DbDailyReportMediaBatch>('SELECT * FROM daily_report_media_batches WHERE id = ?', [id]);
}

export function listDailyReportMediaBatches(userId: string, reportDate?: string, limit = 20): DbDailyReportMediaBatch[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
  const params: any[] = [userId];
  const dateClause = reportDate ? ' AND report_date = ?' : '';
  if (reportDate) params.push(reportDate);
  params.push(safeLimit);
  return queryAll<DbDailyReportMediaBatch>(
    `SELECT * FROM daily_report_media_batches
     WHERE user_id = ?${dateClause}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );
}

export function updateDailyReportMediaBatchStatus(
  id: string,
  status: DbDailyReportMediaBatchStatus,
  failureReason: string | null = null,
  committedAt: string | null = null,
  now = new Date().toISOString(),
): DbDailyReportMediaBatch | undefined {
  run(
    `UPDATE daily_report_media_batches
     SET status = ?, updated_at = ?, committed_at = ?, failure_reason = ?
     WHERE id = ?`,
    [status, now, committedAt, failureReason, id],
  );
  return getDailyReportMediaBatch(id);
}

export function getDailyReportMediaAsset(batchId: string, assetKey: string): DbDailyReportMediaAsset | undefined {
  return queryOne<DbDailyReportMediaAsset>(
    'SELECT * FROM daily_report_media_assets WHERE batch_id = ? AND asset_key = ?',
    [batchId, assetKey],
  );
}

export function listDailyReportMediaAssets(batchId: string): DbDailyReportMediaAsset[] {
  return queryAll<DbDailyReportMediaAsset>(
    'SELECT * FROM daily_report_media_assets WHERE batch_id = ? ORDER BY created_at ASC, asset_key ASC',
    [batchId],
  );
}

export function upsertDailyReportMediaAsset(input: DbDailyReportMediaAsset): DbDailyReportMediaAsset {
  const existing = getDailyReportMediaAsset(input.batch_id, input.asset_key);
  if (existing) {
    run(
      `UPDATE daily_report_media_assets SET
       status = ?, selected_candidate = ?, original_url = ?, source_url = ?, source_domain = ?,
       hosted_url = ?, filename = ?, sha256 = ?, mime_type = ?, size_bytes = ?, attempts_json = ?, updated_at = ?
       WHERE batch_id = ? AND asset_key = ?`,
      [
        input.status,
        input.selected_candidate,
        input.original_url,
        input.source_url,
        input.source_domain,
        input.hosted_url,
        input.filename,
        input.sha256,
        input.mime_type,
        input.size_bytes,
        input.attempts_json,
        input.updated_at,
        input.batch_id,
        input.asset_key,
      ],
    );
  } else {
    run(
      `INSERT INTO daily_report_media_assets
       (id, batch_id, asset_key, status, selected_candidate, original_url, source_url, source_domain,
        hosted_url, filename, sha256, mime_type, size_bytes, attempts_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.batch_id,
        input.asset_key,
        input.status,
        input.selected_candidate,
        input.original_url,
        input.source_url,
        input.source_domain,
        input.hosted_url,
        input.filename,
        input.sha256,
        input.mime_type,
        input.size_bytes,
        input.attempts_json,
        input.created_at,
        input.updated_at,
      ],
    );
  }
  return getDailyReportMediaAsset(input.batch_id, input.asset_key)!;
}

export function deleteDailyReportCloudData(userId: string): void {
  run('DELETE FROM daily_report_cloud_contexts WHERE user_id = ?', [userId]);
  run('DELETE FROM daily_report_cloud_activity WHERE user_id = ?', [userId]);
}
