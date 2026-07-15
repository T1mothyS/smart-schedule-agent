import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'activity.db');

export type ActionSource = 'schedule' | 'reminder';
export type NotificationChannel = 'email' | 'in_app' | 'browser';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface CompletionRecord {
  id: string;
  userId: string;
  sourceType: ActionSource;
  sourceId: string;
  instanceId: string | null;
  completedAt: string;
  note: string | null;
  billDate: string | null;
  reopenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentRecord {
  id: string;
  userId: string;
  completionId: string | null;
  importId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  createdAt: string;
}

export interface NotificationDelivery {
  id: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  instanceId: string | null;
  channel: NotificationChannel;
  kind: string;
  title: string;
  body: string;
  scheduledAt: string;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  readAt: string | null;
  dedupeKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiImportRecord {
  id: string;
  userId: string;
  sourceType: 'text' | 'image' | 'email';
  status: 'draft' | 'confirmed' | 'expired' | 'deleted';
  inputText: string | null;
  draft: Record<string, unknown>;
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

let db: SqlJsDatabase;

function nowIso(): string {
  return new Date().toISOString();
}

function persist(): void {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const statement = db.prepare(sql);
  statement.bind(params.map(value => value === undefined ? null : value));
  const rows: T[] = [];
  while (statement.step()) rows.push(statement.getAsObject() as T);
  statement.free();
  return rows;
}

function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  return queryAll<T>(sql, params)[0];
}

function run(sql: string, params: unknown[] = []): number {
  db.run(sql, params.map(value => value === undefined ? null : value));
  const changes = db.getRowsModified();
  persist();
  return changes;
}

function rowToCompletion(row: any): CompletionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    instanceId: row.instance_id,
    completedAt: row.completed_at,
    note: row.note,
    billDate: row.bill_date,
    reopenedAt: row.reopened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAttachment(row: any): AttachmentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    completionId: row.completion_id,
    importId: row.import_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
}

function rowToNotification(row: any): NotificationDelivery {
  return {
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    instanceId: row.instance_id,
    channel: row.channel,
    kind: row.kind,
    title: row.title,
    body: row.body,
    scheduledAt: row.scheduled_at,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    sentAt: row.sent_at,
    readAt: row.read_at,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAiImport(row: any): AiImportRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type,
    status: row.status,
    inputText: row.input_text,
    draft: JSON.parse(row.draft_json || '{}'),
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function initActivityDb(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS completion_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      instance_id TEXT,
      completed_at TEXT NOT NULL,
      note TEXT,
      amount_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'CNY',
      bill_date TEXT,
      reopened_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      completion_id TEXT,
      import_id TEXT,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      instance_id TEXT,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 4,
      next_retry_at TEXT,
      last_error TEXT,
      sent_at TEXT,
      read_at TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_imports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      input_text TEXT,
      draft_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_import_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      import_token TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_emails (
      message_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      import_id TEXT,
      processed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_completions_user_source ON completion_records(user_id, source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id, completion_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_due ON notification_deliveries(status, scheduled_at, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notification_deliveries(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_imports_user ON ai_imports(user_id, created_at);
  `);
  db.run(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', '1')`);
  db.run(`UPDATE notification_deliveries SET status = 'failed', next_retry_at = ? WHERE status = 'sending'`, [nowIso()]);
  persist();
}

export function createCompletion(input: {
  userId: string;
  sourceType: ActionSource;
  sourceId: string;
  instanceId?: string | null;
  completedAt?: string;
  note?: string | null;
  billDate?: string | null;
}): CompletionRecord {
  const now = nowIso();
  const record: CompletionRecord = {
    id: uuidv4(),
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    instanceId: input.instanceId || null,
    completedAt: input.completedAt || now,
    note: input.note?.trim() || null,
    billDate: input.billDate || null,
    reopenedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  run(
    `INSERT INTO completion_records
      (id, user_id, source_type, source_id, instance_id, completed_at, note, bill_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.userId, record.sourceType, record.sourceId, record.instanceId, record.completedAt,
      record.note, record.billDate, now, now],
  );
  addAudit(record.userId, 'completion', record.id, 'completed', record.note || undefined);
  return record;
}

export function getCompletion(id: string, userId: string): CompletionRecord | null {
  const row = queryOne<any>('SELECT * FROM completion_records WHERE id = ? AND user_id = ?', [id, userId]);
  return row ? rowToCompletion(row) : null;
}

export function updateCompletion(
  id: string,
  userId: string,
  changes: Partial<Pick<CompletionRecord, 'completedAt' | 'note' | 'billDate'>>,
): CompletionRecord | null {
  const current = getCompletion(id, userId);
  if (!current) return null;
  const completedAt = changes.completedAt ?? current.completedAt;
  const note = changes.note === undefined ? current.note : changes.note?.trim() || null;
  const billDate = changes.billDate === undefined ? current.billDate : changes.billDate || null;
  const now = nowIso();
  run(
    'UPDATE completion_records SET completed_at = ?, note = ?, bill_date = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [completedAt, note, billDate, now, id, userId],
  );
  addAudit(userId, 'completion', id, 'updated');
  return getCompletion(id, userId);
}

export function reopenCompletion(id: string, userId: string): CompletionRecord | null {
  const record = getCompletion(id, userId);
  if (!record) return null;
  const now = nowIso();
  run('UPDATE completion_records SET reopened_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [now, now, id, userId]);
  addAudit(userId, 'completion', id, 'reopened');
  return getCompletion(id, userId);
}

export function listCompletions(userId: string, filters: { sourceType?: string; sourceId?: string; date?: string } = {}): CompletionRecord[] {
  const clauses = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (filters.sourceType) { clauses.push('source_type = ?'); params.push(filters.sourceType); }
  if (filters.sourceId) { clauses.push('source_id = ?'); params.push(filters.sourceId); }
  if (filters.date) { clauses.push('substr(completed_at, 1, 10) = ?'); params.push(filters.date); }
  return queryAll<any>(`SELECT * FROM completion_records WHERE ${clauses.join(' AND ')} ORDER BY completed_at DESC`, params).map(rowToCompletion);
}

export function addAttachment(input: Omit<AttachmentRecord, 'id' | 'createdAt'>): AttachmentRecord {
  const existing = queryOne<any>(
    `SELECT * FROM attachments WHERE user_id = ? AND sha256 = ? AND completion_id IS ? AND import_id IS ?`,
    [input.userId, input.sha256, input.completionId, input.importId],
  );
  if (existing) return rowToAttachment(existing);
  const record: AttachmentRecord = { ...input, id: uuidv4(), createdAt: nowIso() };
  run(
    `INSERT INTO attachments (id, user_id, completion_id, import_id, original_name, mime_type, size_bytes, sha256, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.userId, record.completionId, record.importId, record.originalName, record.mimeType,
      record.sizeBytes, record.sha256, record.storagePath, record.createdAt],
  );
  addAudit(record.userId, 'attachment', record.id, 'uploaded', record.originalName);
  return record;
}

export function getAttachment(id: string, userId: string): AttachmentRecord | null {
  const row = queryOne<any>('SELECT * FROM attachments WHERE id = ? AND user_id = ?', [id, userId]);
  return row ? rowToAttachment(row) : null;
}

export function listAttachments(userId: string, completionId?: string, importId?: string): AttachmentRecord[] {
  const clauses = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (completionId) { clauses.push('completion_id = ?'); params.push(completionId); }
  if (importId) { clauses.push('import_id = ?'); params.push(importId); }
  return queryAll<any>(`SELECT * FROM attachments WHERE ${clauses.join(' AND ')} ORDER BY created_at`, params).map(rowToAttachment);
}

export function deleteAttachment(id: string, userId: string): AttachmentRecord | null {
  const record = getAttachment(id, userId);
  if (!record) return null;
  run('DELETE FROM attachments WHERE id = ? AND user_id = ?', [id, userId]);
  addAudit(userId, 'attachment', id, 'deleted', record.originalName);
  return record;
}

export function getUserAttachmentBytes(userId: string): number {
  const row = queryOne<{ total: number }>('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM attachments WHERE user_id = ?', [userId]);
  return Number(row?.total || 0);
}

export function enqueueNotification(input: {
  userId: string;
  sourceType: string;
  sourceId: string;
  instanceId?: string | null;
  channel: NotificationChannel;
  kind: string;
  title: string;
  body: string;
  scheduledAt: string;
  dedupeKey: string;
}): NotificationDelivery {
  const existing = queryOne<any>('SELECT * FROM notification_deliveries WHERE dedupe_key = ?', [input.dedupeKey]);
  if (existing) return rowToNotification(existing);
  const now = nowIso();
  const id = uuidv4();
  run(
    `INSERT INTO notification_deliveries
      (id, user_id, source_type, source_id, instance_id, channel, kind, title, body, scheduled_at, status, attempts, max_attempts, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 4, ?, ?, ?)`,
    [id, input.userId, input.sourceType, input.sourceId, input.instanceId || null, input.channel, input.kind,
      input.title, input.body, input.scheduledAt, input.dedupeKey, now, now],
  );
  return getNotification(id)!;
}

export function getNotification(id: string, userId?: string): NotificationDelivery | null {
  const row = userId
    ? queryOne<any>('SELECT * FROM notification_deliveries WHERE id = ? AND user_id = ?', [id, userId])
    : queryOne<any>('SELECT * FROM notification_deliveries WHERE id = ?', [id]);
  return row ? rowToNotification(row) : null;
}

export function listNotifications(userId: string, filters: { status?: string; channel?: string; unreadOnly?: boolean; limit?: number } = {}): NotificationDelivery[] {
  const clauses = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
  if (filters.channel) { clauses.push('channel = ?'); params.push(filters.channel); }
  if (filters.unreadOnly) clauses.push('read_at IS NULL AND status = \'sent\'');
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 500);
  params.push(limit);
  return queryAll<any>(`SELECT * FROM notification_deliveries WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`, params).map(rowToNotification);
}

export function listDueNotifications(now = nowIso()): NotificationDelivery[] {
  return queryAll<any>(
    `SELECT * FROM notification_deliveries
     WHERE status IN ('pending', 'failed') AND attempts < max_attempts
       AND scheduled_at <= ? AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY scheduled_at ASC LIMIT 100`,
    [now, now],
  ).map(rowToNotification);
}

export function claimNotification(id: string): boolean {
  return run(
    `UPDATE notification_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'failed') AND attempts < max_attempts`,
    [nowIso(), id],
  ) > 0;
}

export function markNotificationSent(id: string): void {
  const now = nowIso();
  run(`UPDATE notification_deliveries SET status = 'sent', sent_at = ?, next_retry_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?`, [now, now, id]);
}

export function markNotificationFailed(id: string, error: string): void {
  const item = getNotification(id);
  if (!item) return;
  const retryDelays = [5, 30, 120];
  const delayMinutes = retryDelays[Math.min(Math.max(item.attempts - 1, 0), retryDelays.length - 1)];
  const retryAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
  run(
    `UPDATE notification_deliveries SET status = 'failed', last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
    [error.slice(0, 800), retryAt, nowIso(), id],
  );
}

export function markNotificationRead(id: string, userId: string): NotificationDelivery | null {
  const item = getNotification(id, userId);
  if (!item) return null;
  run('UPDATE notification_deliveries SET read_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', [nowIso(), nowIso(), id, userId]);
  return getNotification(id, userId);
}

export function retryNotification(id: string, userId: string): NotificationDelivery | null {
  const item = getNotification(id, userId);
  if (!item || item.status !== 'failed') return null;
  run(`UPDATE notification_deliveries SET status = 'pending', attempts = 0, next_retry_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?`, [nowIso(), id]);
  return getNotification(id, userId);
}

export function createAiImport(input: {
  userId: string;
  sourceType: 'text' | 'image' | 'email';
  inputText?: string | null;
  draft: Record<string, unknown>;
  expiresAt?: string;
}): AiImportRecord {
  const now = nowIso();
  const id = uuidv4();
  const expiresAt = input.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  run(
    `INSERT INTO ai_imports (id, user_id, source_type, status, input_text, draft_json, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    [id, input.userId, input.sourceType, input.inputText || null, JSON.stringify(input.draft), expiresAt, now, now],
  );
  return getAiImport(id, input.userId)!;
}

export function getAiImport(id: string, userId: string): AiImportRecord | null {
  const row = queryOne<any>('SELECT * FROM ai_imports WHERE id = ? AND user_id = ?', [id, userId]);
  return row ? rowToAiImport(row) : null;
}

export function listAiImports(userId: string, status = 'draft'): AiImportRecord[] {
  return queryAll<any>('SELECT * FROM ai_imports WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 50', [userId, status]).map(rowToAiImport);
}

export function confirmAiImport(id: string, userId: string, draft: Record<string, unknown>): AiImportRecord | null {
  const current = getAiImport(id, userId);
  if (!current || current.status !== 'draft' || current.expiresAt < nowIso()) return null;
  const now = nowIso();
  run(`UPDATE ai_imports SET status = 'confirmed', draft_json = ?, confirmed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [JSON.stringify(draft), now, now, id, userId]);
  return getAiImport(id, userId);
}

export function deleteAiImport(id: string, userId: string): boolean {
  return run(`UPDATE ai_imports SET status = 'deleted', input_text = NULL, updated_at = ? WHERE id = ? AND user_id = ?`, [nowIso(), id, userId]) > 0;
}

export function expireAiImports(): number {
  return run(`UPDATE ai_imports SET status = 'expired', input_text = NULL, updated_at = ? WHERE status = 'draft' AND expires_at < ?`, [nowIso(), nowIso()]);
}

export function getEmailImportSetting(userId: string): { enabled: boolean; importToken: string } {
  let row = queryOne<any>('SELECT * FROM email_import_settings WHERE user_id = ?', [userId]);
  if (!row) {
    run('INSERT INTO email_import_settings (user_id, enabled, import_token, updated_at) VALUES (?, 0, ?, ?)', [userId, uuidv4().replace(/-/g, ''), nowIso()]);
    row = queryOne<any>('SELECT * FROM email_import_settings WHERE user_id = ?', [userId]);
  }
  return { enabled: row.enabled === 1, importToken: row.import_token };
}

export function updateEmailImportSetting(userId: string, enabled: boolean, regenerate = false): { enabled: boolean; importToken: string } {
  const current = getEmailImportSetting(userId);
  const token = regenerate ? uuidv4().replace(/-/g, '') : current.importToken;
  run('UPDATE email_import_settings SET enabled = ?, import_token = ?, updated_at = ? WHERE user_id = ?', [enabled ? 1 : 0, token, nowIso(), userId]);
  return { enabled, importToken: token };
}

export function findUserByImportToken(token: string): string | null {
  const row = queryOne<{ user_id: string }>('SELECT user_id FROM email_import_settings WHERE enabled = 1 AND import_token = ?', [token]);
  return row?.user_id || null;
}

export function isEmailProcessed(messageId: string): boolean {
  return !!queryOne('SELECT message_id FROM processed_emails WHERE message_id = ?', [messageId]);
}

export function markEmailProcessed(messageId: string, userId: string, importId?: string): void {
  run('INSERT OR IGNORE INTO processed_emails (message_id, user_id, import_id, processed_at) VALUES (?, ?, ?, ?)', [messageId, userId, importId || null, nowIso()]);
}

function addAudit(userId: string, entityType: string, entityId: string, action: string, details?: string): void {
  run(
    'INSERT INTO activity_audit_logs (id, user_id, entity_type, entity_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), userId, entityType, entityId, action, details || null, nowIso()],
  );
}

export function exportUserActivity(userId: string): Record<string, unknown[]> {
  return {
    completions: queryAll<any>('SELECT * FROM completion_records WHERE user_id = ?', [userId]),
    attachments: queryAll<any>('SELECT * FROM attachments WHERE user_id = ?', [userId]),
    notifications: queryAll<any>('SELECT * FROM notification_deliveries WHERE user_id = ?', [userId]),
    aiImports: queryAll<any>(`SELECT * FROM ai_imports WHERE user_id = ? AND status = 'confirmed'`, [userId]),
    emailImportSettings: queryAll<any>('SELECT * FROM email_import_settings WHERE user_id = ?', [userId]),
  };
}

export function exportActivityDb(): Buffer {
  return Buffer.from(db.export());
}

export function restoreUserActivity(
  userId: string,
  data: Record<string, any[]>,
  mode: 'merge' | 'replace',
): { completions: number; notifications: number; aiImports: number } {
  if (mode === 'replace') {
    db.run('DELETE FROM attachments WHERE user_id = ?', [userId]);
    db.run('DELETE FROM completion_records WHERE user_id = ?', [userId]);
    db.run('DELETE FROM notification_deliveries WHERE user_id = ?', [userId]);
    db.run('DELETE FROM ai_imports WHERE user_id = ?', [userId]);
    db.run('DELETE FROM email_import_settings WHERE user_id = ?', [userId]);
  }
  let completions = 0;
  let notifications = 0;
  let aiImports = 0;
  for (const row of data.completions || []) {
    if (!row?.id || queryOne('SELECT id FROM completion_records WHERE id = ?', [row.id])) continue;
    db.run(
      `INSERT INTO completion_records (id, user_id, source_type, source_id, instance_id, completed_at, note, amount_cents, currency,
       bill_date, reopened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, userId, row.source_type, row.source_id, row.instance_id || null, row.completed_at, row.note || null,
        row.amount_cents ?? null, row.currency || 'CNY', row.bill_date || null, row.reopened_at || null,
        row.created_at || nowIso(), row.updated_at || nowIso()],
    );
    completions++;
  }
  for (const row of data.notifications || []) {
    if (!row?.id || queryOne('SELECT id FROM notification_deliveries WHERE id = ? OR dedupe_key = ?', [row.id, row.dedupe_key])) continue;
    db.run(
      `INSERT INTO notification_deliveries (id, user_id, source_type, source_id, instance_id, channel, kind, title, body,
       scheduled_at, status, attempts, max_attempts, next_retry_at, last_error, sent_at, read_at, dedupe_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, userId, row.source_type, row.source_id, row.instance_id || null, row.channel, row.kind, row.title, row.body,
        row.scheduled_at, row.status, row.attempts || 0, row.max_attempts || 4, row.next_retry_at || null, row.last_error || null,
        row.sent_at || null, row.read_at || null, row.dedupe_key, row.created_at || nowIso(), row.updated_at || nowIso()],
    );
    notifications++;
  }
  for (const row of data.aiImports || []) {
    if (!row?.id || queryOne('SELECT id FROM ai_imports WHERE id = ?', [row.id])) continue;
    db.run(
      `INSERT INTO ai_imports (id, user_id, source_type, status, input_text, draft_json, expires_at, confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [row.id, userId, row.source_type, row.status, row.draft_json || '{}', row.expires_at || nowIso(), row.confirmed_at || null,
        row.created_at || nowIso(), row.updated_at || nowIso()],
    );
    aiImports++;
  }
  const setting = (data.emailImportSettings || [])[0];
  if (setting) {
    db.run(
      'INSERT OR REPLACE INTO email_import_settings (user_id, enabled, import_token, updated_at) VALUES (?, ?, ?, ?)',
      [userId, setting.enabled ? 1 : 0, setting.import_token || uuidv4().replace(/-/g, ''), nowIso()],
    );
  }
  persist();
  return { completions, notifications, aiImports };
}
