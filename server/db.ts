import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径；测试可通过 DATA_DIR 使用隔离目录。
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'chat.db');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 数据库实例
let db: SqlJsDatabase;

export function assertNoUnreconciledChatWal(databasePath = dbPath): void {
  const walPath = databasePath + '-wal';
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    throw new Error(
      `检测到未合并的 SQLite WAL：${walPath}。为避免 sql.js 覆盖其中的数据，服务已停止启动。` +
      '请先在服务停止状态下运行 scripts/reconcile_chat_wal.py。',
    );
  }
}

// 初始化数据库
async function initDb(): Promise<void> {
  assertNoUnreconciledChatWal();
  const SQL = await initSqlJs();

  // 尝试加载已有数据库
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // sql.js 以内存数据库运行并整体导出文件，不能消费原生 SQLite WAL。
  db.run('PRAGMA journal_mode = DELETE');

  // 初始化表
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      sdk_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL,
      tool_calls TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_schedule_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      intent TEXT,
      schedule_items TEXT,
      plan TEXT,
      knowledge_sources TEXT,
      created_at TEXT NOT NULL
    )
  `);

  const aiScheduleMessageColumns = queryAll<{ name: string }>('PRAGMA table_info(ai_schedule_messages)');
  if (!aiScheduleMessageColumns.some(column => column.name === 'knowledge_sources')) {
    db.run('ALTER TABLE ai_schedule_messages ADD COLUMN knowledge_sources TEXT');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      auth_version INTEGER NOT NULL DEFAULT 0,
      preferred_model TEXT,
      admin_shared_api_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )
  `);

  const userColumns = queryAll<{ name: string }>('PRAGMA table_info(users)');
  if (!userColumns.some(column => column.name === 'auth_version')) {
    db.run('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.some(column => column.name === 'preferred_model')) {
    db.run('ALTER TABLE users ADD COLUMN preferred_model TEXT');
  }
  if (!userColumns.some(column => column.name === 'admin_shared_api_enabled')) {
    db.run('ALTER TABLE users ADD COLUMN admin_shared_api_enabled INTEGER NOT NULL DEFAULT 0');
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      role TEXT PRIMARY KEY CHECK (role IN ('admin', 'user')),
      code_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      rotated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )
  `);

  const sessionColumns = queryAll<{ name: string }>('PRAGMA table_info(sessions)');
  if (!sessionColumns.some(column => column.name === 'user_id')) {
    db.run('ALTER TABLE sessions ADD COLUMN user_id TEXT');
  }
  const legacySessionOwner = queryOne<{ id: string }>(
    "SELECT id FROM users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
  );
  if (legacySessionOwner) {
    db.run("UPDATE sessions SET user_id = ? WHERE user_id IS NULL OR user_id = ''", [legacySessionOwner.id]);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS email_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset_password')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      hour INTEGER NOT NULL DEFAULT 8,
      minute INTEGER NOT NULL DEFAULT 0,
      reminder_email TEXT,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      report_email_enabled INTEGER NOT NULL DEFAULT 0,
      daily_report_delivery_sources TEXT NOT NULL DEFAULT '["local"]',
      in_app_enabled INTEGER NOT NULL DEFAULT 1,
      browser_enabled INTEGER NOT NULL DEFAULT 1,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_start TEXT NOT NULL DEFAULT '22:00',
      quiet_end TEXT NOT NULL DEFAULT '08:00',
      home_location_name TEXT,
      home_location_admin1 TEXT,
      home_location_country TEXT,
      home_latitude REAL,
      home_longitude REAL,
      home_timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  const reminderColumns = queryAll<{ name: string }>('PRAGMA table_info(reminders)');
  if (!reminderColumns.some(column => column.name === 'reminder_email')) {
    db.run('ALTER TABLE reminders ADD COLUMN reminder_email TEXT');
  }
  const reminderMigrations: Array<[string, string]> = [
    ['email_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['report_email_enabled', "INTEGER NOT NULL DEFAULT 0"],
    ['daily_report_delivery_sources', "TEXT NOT NULL DEFAULT '[\"local\"]'"],
    ['in_app_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['browser_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['timezone', "TEXT NOT NULL DEFAULT 'Asia/Shanghai'"],
    ['quiet_hours_enabled', "INTEGER NOT NULL DEFAULT 0"],
    ['quiet_start', "TEXT NOT NULL DEFAULT '22:00'"],
    ['quiet_end', "TEXT NOT NULL DEFAULT '08:00'"],
    ['home_location_name', 'TEXT'],
    ['home_location_admin1', 'TEXT'],
    ['home_location_country', 'TEXT'],
    ['home_latitude', 'REAL'],
    ['home_longitude', 'REAL'],
    ['home_timezone', 'TEXT'],
  ];
  for (const [name, definition] of reminderMigrations) {
    if (!reminderColumns.some(column => column.name === name)) db.run(`ALTER TABLE reminders ADD COLUMN ${name} ${definition}`);
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      api_key TEXT NOT NULL,
      base_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ChatGPT Work Cloud 的日报连接使用独立 OAuth 记录；只保存哈希和最小授权元数据。
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_contexts (
      user_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_activity (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      title TEXT NOT NULL,
      evidence TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      redirect_uris_json TEXT NOT NULL,
      grant_types_json TEXT NOT NULL,
      response_types_json TEXT NOT NULL,
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      state TEXT,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      resource TEXT NOT NULL,
      csrf_hash TEXT NOT NULL,
      user_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      rotated_at TEXT,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_mail_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'qq' CHECK (provider = 'qq'),
      username TEXT NOT NULL,
      encrypted_auth_code TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS note_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      color TEXT NOT NULL DEFAULT 'neutral' CHECK (color IN ('neutral', 'purple', 'blue', 'green', 'amber', 'rose')),
      linked_schedule_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  const noteColumns = queryAll<{ name: string }>('PRAGMA table_info(note_items)');
  if (!noteColumns.some(column => column.name === 'color')) {
    // 旧版本没有颜色列，新增列使用中性灰作为安全默认值；SQLite 旧表无法原地补 CHECK 约束，API 层仍会严格校验写入值。
    db.run("ALTER TABLE note_items ADD COLUMN color TEXT NOT NULL DEFAULT 'neutral'");
  }
  db.run("UPDATE note_items SET color = 'neutral' WHERE color IS NULL OR color NOT IN ('neutral', 'purple', 'blue', 'green', 'amber', 'rose')");

  db.run(`
    CREATE TABLE IF NOT EXISTS library_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('fragment', 'article')),
      type TEXT NOT NULL CHECK (type IN ('knowledge', 'insight', 'framework', 'experience', 'tutorial', 'reference')),
      source_id TEXT,
      slug TEXT,
      title TEXT,
      content TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      source_url TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      relations_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      archived_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  const libraryEntryColumns = queryAll<{ name: string }>('PRAGMA table_info(library_entries)');
  const libraryEntryMigrations: Array<[string, string]> = [
    ['kind', "TEXT NOT NULL DEFAULT 'fragment'"],
    ['type', "TEXT NOT NULL DEFAULT 'knowledge'"],
    ['source_id', 'TEXT'],
    ['slug', 'TEXT'],
    ['summary', "TEXT NOT NULL DEFAULT ''"],
    ['tags_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['source_type', "TEXT NOT NULL DEFAULT 'manual'"],
    ['source_ref', 'TEXT'],
    ['source_url', 'TEXT'],
    ['metadata_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['relations_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['content_hash', "TEXT NOT NULL DEFAULT ''"],
    ['published_at', 'TEXT'],
    ['archived_at', 'TEXT'],
  ];
  for (const [name, definition] of libraryEntryMigrations) {
    if (!libraryEntryColumns.some(column => column.name === name)) {
      db.run(`ALTER TABLE library_entries ADD COLUMN ${name} ${definition}`);
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS library_preferences (
      user_id TEXT PRIMARY KEY,
      sort TEXT NOT NULL CHECK (sort IN ('title_asc', 'title_desc', 'updated_asc', 'updated_desc', 'created_asc', 'created_desc')),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Cloud 日报媒体准备批次；媒体正文仍保存在 daily-report-media 文件目录，数据库只保存归属和校验元数据。
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_media_batches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('PREPARING', 'READY', 'COMMITTED', 'FAILED', 'PENDING_RETRY', 'EXPIRED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      committed_at TEXT,
      failure_reason TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_media_assets (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('HOSTED', 'FAILED')),
      selected_candidate INTEGER,
      original_url TEXT,
      source_url TEXT,
      source_domain TEXT,
      hosted_url TEXT,
      filename TEXT,
      sha256 TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      attempts_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (batch_id, asset_key),
      FOREIGN KEY (batch_id) REFERENCES daily_report_media_batches(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS library_entry_versions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      title TEXT,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      relations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  const libraryVersionColumns = queryAll<{ name: string }>('PRAGMA table_info(library_entry_versions)');
  if (!libraryVersionColumns.some(column => column.name === 'relations_json')) {
    db.run("ALTER TABLE library_entry_versions ADD COLUMN relations_json TEXT NOT NULL DEFAULT '[]'");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS library_comments (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS library_publish_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 创建索引
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ai_schedule_messages_user_created ON ai_schedule_messages(user_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_token_hash ON daily_report_tokens(token_hash)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_cloud_activity_user_date ON daily_report_cloud_activity(user_id, activity_date DESC, updated_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_media_batches_user_date ON daily_report_media_batches(user_id, report_date DESC, updated_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_media_batches_expiry ON daily_report_media_batches(status, expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_media_assets_batch ON daily_report_media_assets(batch_id, updated_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_expires ON oauth_authorization_requests(expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expires ON oauth_authorization_codes(expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id, revoked_at, expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family ON oauth_refresh_tokens(family_id, revoked_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_note_items_user_updated ON note_items(user_id, updated_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_entries_user_updated ON library_entries(user_id, updated_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_entries_user_kind ON library_entries(user_id, kind, status)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_library_entries_user_source ON library_entries(user_id, source_id) WHERE source_id IS NOT NULL');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_versions_entry_created ON library_entry_versions(entry_id, created_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_comments_entry_created ON library_comments(entry_id, created_at ASC)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_library_publish_token_hash ON library_publish_tokens(token_hash)');

  // 保存到文件
  saveDb();

  console.log('[DB] Database initialized with sql.js');
}

// 保存数据库到文件
function saveDb(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// 辅助函数：将结果转为对象数组
function queryAll<T>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

function queryOne<T>(sql: string, params: any[] = []): T | undefined {
  const results = queryAll<T>(sql, params);
  return results[0];
}

function run(sql: string, params: any[] = []): { changes: number } {
  // 将所有 undefined 转为 null（sql.js 不允许 undefined）
  const safeParams = params.map(p => p === undefined ? null : p);
  db.run(sql, safeParams);
  const changes = db.getRowsModified();
  saveDb();
  return { changes };
}

function executeWithoutSave(sql: string, params: any[] = []): void {
  const safeParams = params.map(p => p === undefined ? null : p);
  db.run(sql, safeParams);
}

function runTransaction<T>(callback: () => T): T {
  executeWithoutSave('BEGIN');
  try {
    const result = callback();
    executeWithoutSave('COMMIT');
    saveDb();
    return result;
  } catch (error) {
    try { executeWithoutSave('ROLLBACK'); } catch {}
    saveDb();
    throw error;
  }
}

// 类型定义
export interface DbSession {
  id: string;
  user_id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

export interface DbAiScheduleMessage {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  type: string;
  content: string;
  intent: string | null;
  schedule_items: string | null;
  plan: string | null;
  knowledge_sources?: string | null;
  created_at: string;
}

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  disabled: number;
  auth_version?: number;
  preferred_model?: string | null;
  admin_shared_api_enabled?: number;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface DbInviteCode {
  role: 'admin' | 'user';
  code_hash: string;
  created_at: string;
  rotated_at: string;
  version: number;
}

export interface DbEmailCode {
  id: string;
  email: string;
  code: string;
  purpose: 'register' | 'reset_password';
  expires_at: string;
  created_at: string;
}

export interface DbReminder {
  id: string;
  user_id: string;
  enabled: number;
  hour: number;
  minute: number;
  reminder_email?: string | null;
  email_enabled?: number;
  report_email_enabled?: number;
  daily_report_delivery_sources?: string | null;
  in_app_enabled?: number;
  browser_enabled?: number;
  timezone?: string;
  quiet_hours_enabled?: number;
  quiet_start?: string;
  quiet_end?: string;
  home_location_name?: string | null;
  home_location_admin1?: string | null;
  home_location_country?: string | null;
  home_latitude?: number | null;
  home_longitude?: number | null;
  home_timezone?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbUserApiKey {
  id: string;
  user_id: string;
  api_key: string;
  base_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbDailyReportToken {
  id: string;
  user_id: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DbDailyReportCloudContext {
  user_id: string;
  version: number;
  context_json: string;
  created_at: string;
  updated_at: string;
}

export interface DbDailyReportCloudActivity {
  id: string;
  user_id: string;
  activity_date: string;
  title: string;
  evidence: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export type DbDailyReportMediaBatchStatus = 'PREPARING' | 'READY' | 'COMMITTED' | 'FAILED' | 'PENDING_RETRY' | 'EXPIRED';

export interface DbDailyReportMediaBatch {
  id: string;
  user_id: string;
  report_date: string;
  run_id: string;
  status: DbDailyReportMediaBatchStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  committed_at: string | null;
  failure_reason: string | null;
}

export type DbDailyReportMediaAssetStatus = 'HOSTED' | 'FAILED';

export interface DbDailyReportMediaAsset {
  id: string;
  batch_id: string;
  asset_key: string;
  status: DbDailyReportMediaAssetStatus;
  selected_candidate: number | null;
  original_url: string | null;
  source_url: string | null;
  source_domain: string | null;
  hosted_url: string | null;
  filename: string | null;
  sha256: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  attempts_json: string;
  created_at: string;
  updated_at: string;
}

export interface DbOAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  grant_types_json: string;
  response_types_json: string;
  token_endpoint_auth_method: string;
  created_at: string;
  updated_at: string;
}

export interface DbOAuthAuthorizationRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  csrf_hash: string;
  user_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface DbOAuthAuthorizationCode {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  expires_at: string;
  created_at: string;
  used_at: string | null;
}

export interface DbOAuthAccessToken {
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DbOAuthRefreshToken {
  token_hash: string;
  family_id: string;
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  rotated_at: string | null;
}

export interface DbUserMailAccount {
  id: string;
  user_id: string;
  provider: 'qq';
  username: string;
  encrypted_auth_code: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DbNoteItem {
  id: string;
  user_id: string;
  content: string;
  completed: number;
  completed_at: string | null;
  color: string;
  linked_schedule_ids: string;
  created_at: string;
  updated_at: string;
}

export interface DbLibraryEntry {
  id: string;
  user_id: string;
  kind: 'fragment' | 'article';
  type: 'knowledge' | 'insight' | 'framework' | 'experience' | 'tutorial' | 'reference';
  source_id: string | null;
  slug: string | null;
  title: string | null;
  content: string;
  summary: string;
  tags_json: string;
  status: 'draft' | 'active' | 'archived';
  source_type: string;
  source_ref: string | null;
  source_url: string | null;
  metadata_json: string;
  relations_json: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
}

export type DbLibrarySort = 'title_asc' | 'title_desc' | 'updated_asc' | 'updated_desc' | 'created_asc' | 'created_desc';

export interface DbLibraryPreference {
  user_id: string;
  sort: DbLibrarySort;
  updated_at: string;
}

export interface DbLibraryEntryVersion {
  id: string;
  entry_id: string;
  user_id: string;
  content_hash: string;
  title: string | null;
  summary: string;
  content: string;
  tags_json: string;
  relations_json: string;
  created_at: string;
}

export interface DbLibraryComment {
  id: string;
  entry_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface DbLibraryPublishToken {
  id: string;
  user_id: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// ============= 会话操作 =============

export function getAllSessions(userId: string): DbSession[] {
  return queryAll<DbSession>('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
}

export function getSession(id: string, userId: string): DbSession | undefined {
  return queryOne<DbSession>('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [id, userId]);
}

export function createSession(session: DbSession): DbSession {
  run(
    'INSERT INTO sessions (id, user_id, title, model, sdk_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [session.id, session.user_id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at]
  );
  return session;
}

export function updateSession(id: string, userId: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  values.push(userId);

  const result = run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  return result.changes > 0;
}

export function deleteSession(id: string, userId: string): boolean {
  if (!getSession(id, userId)) return false;
  run('DELETE FROM messages WHERE session_id = ?', [id]);
  const result = run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, userId]);
  return result.changes > 0;
}

// ============= 消息操作 =============

export function getMessagesBySession(sessionId: string, userId: string): DbMessage[] {
  return queryAll<DbMessage>(
    'SELECT messages.* FROM messages JOIN sessions ON sessions.id = messages.session_id WHERE messages.session_id = ? AND sessions.user_id = ? ORDER BY messages.created_at ASC',
    [sessionId, userId]
  );
}

export function createMessage(message: DbMessage, userId: string): DbMessage {
  if (!getSession(message.session_id, userId)) throw new Error('会话不存在或无权访问');
  run(
    'INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [message.id, message.session_id, message.role, message.content, message.model, message.created_at, message.tool_calls]
  );

  run('UPDATE sessions SET updated_at = ? WHERE id = ? AND user_id = ?', [new Date().toISOString(), message.session_id, userId]);

  return message;
}

export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }

  if (fields.length === 0) return false;

  values.push(id);

  const result = run(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`, values);
  return result.changes > 0;
}

export function deleteMessage(id: string): boolean {
  const result = run('DELETE FROM messages WHERE id = ?', [id]);
  return result.changes > 0;
}

export function createMessages(messages: DbMessage[], userId: string): void {
  for (const msg of messages) {
    createMessage(msg, userId);
  }
}

// ============= AI 日程助手历史 =============

export function getAiScheduleMessages(userId: string, limit = 20): DbAiScheduleMessage[] {
  if (limit <= 0) {
    return queryAll<DbAiScheduleMessage>(
      'SELECT * FROM ai_schedule_messages WHERE user_id = ? ORDER BY created_at ASC',
      [userId],
    );
  }
  const safeLimit = Math.min(Math.floor(limit) || 20, 2000);
  return queryAll<DbAiScheduleMessage>(
    'SELECT * FROM ai_schedule_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, safeLimit],
  ).reverse();
}

export function createAiScheduleMessage(message: DbAiScheduleMessage): DbAiScheduleMessage {
  run(
    `INSERT INTO ai_schedule_messages
      (id, user_id, role, type, content, intent, schedule_items, plan, knowledge_sources, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.user_id,
      message.role,
      message.type,
      message.content,
      message.intent,
      message.schedule_items,
      message.plan,
      message.knowledge_sources ?? null,
      message.created_at,
    ],
  );
  return message;
}

export function updateAiScheduleMessage(
  id: string,
  userId: string,
  updates: Partial<Pick<DbAiScheduleMessage, 'type' | 'content' | 'intent' | 'schedule_items' | 'plan' | 'knowledge_sources'>>,
): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  for (const field of ['type', 'content', 'intent', 'schedule_items', 'plan', 'knowledge_sources'] as const) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(updates[field]);
    }
  }
  if (!fields.length) return false;
  values.push(id, userId);
  return run(`UPDATE ai_schedule_messages SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values).changes > 0;
}

export function deleteAiScheduleMessage(id: string, userId: string): boolean {
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM ai_schedule_messages WHERE id = ? AND user_id = ?',
    [id, userId],
  );
  if (!existing) return false;
  run('DELETE FROM ai_schedule_messages WHERE id = ? AND user_id = ?', [id, userId]);
  return true;
}

/**
 * 清理过期历史时逐条删除，避免一次批量删除阻塞数据库，也便于统计实际清理数量。
 */
export function deleteExpiredAiScheduleMessages(beforeIso: string, userId?: string): number {
  const rows = userId
    ? queryAll<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM ai_schedule_messages WHERE user_id = ? AND created_at < ? ORDER BY created_at ASC',
        [userId, beforeIso],
      )
    : queryAll<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM ai_schedule_messages WHERE created_at < ? ORDER BY created_at ASC',
        [beforeIso],
      );
  let deleted = 0;
  for (const row of rows) {
    if (deleteAiScheduleMessage(row.id, row.user_id)) deleted += 1;
  }
  return deleted;
}

export function clearAllData(): void {
  run('DELETE FROM messages');
  run('DELETE FROM sessions');
  run('DELETE FROM ai_schedule_messages');
  run('DELETE FROM note_items');
}

// ============= 用户操作 =============

type PublicDbUser = Omit<DbUser, 'password_hash' | 'disabled' | 'last_login_at' | 'auth_version' | 'preferred_model' | 'admin_shared_api_enabled'> & {
  disabled: boolean;
  admin_shared_api_enabled: boolean;
  last_login_at: string | null;
};

export function getAllUsers(): PublicDbUser[] {
  const users = queryAll<any>('SELECT id, email, role, disabled, admin_shared_api_enabled, created_at, updated_at, last_login_at FROM users ORDER BY created_at DESC');
  return users.map(u => ({
    ...u,
    disabled: Boolean(u.disabled),
    admin_shared_api_enabled: Boolean(u.admin_shared_api_enabled),
    last_login_at: u.last_login_at || null
  }));
}

export function getUsersPaginated(page: number, pageSize: number, search: string): {
  users: PublicDbUser[];
  total: number;
  page: number;
  pageSize: number;
} {
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  let params: any[] = [];

  if (search) {
    whereClause = 'WHERE email LIKE ?';
    params.push(`%${search}%`);
  }

  const countResult = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM users ${whereClause}`, params);
  const total = countResult?.count || 0;

  const users = queryAll<any>(
    `SELECT id, email, role, disabled, admin_shared_api_enabled, created_at, updated_at, last_login_at FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    users: users.map(u => ({
      ...u,
      disabled: Boolean(u.disabled),
      admin_shared_api_enabled: Boolean(u.admin_shared_api_enabled),
      last_login_at: u.last_login_at || null
    })),
    total,
    page,
    pageSize,
  };
}

export function getUserByEmail(email: string): DbUser | undefined {
  return queryOne<DbUser>('SELECT * FROM users WHERE email = ?', [email]);
}

export function getUserById(id: string): Omit<DbUser, 'password_hash'> | undefined {
  return queryOne<Omit<DbUser, 'password_hash'>>(
    'SELECT id, email, role, disabled, auth_version, preferred_model, admin_shared_api_enabled, created_at, updated_at, last_login_at FROM users WHERE id = ?',
    [id],
  );
}

export function createUser(user: DbUser): Omit<DbUser, 'password_hash'> {
  run(
    'INSERT INTO users (id, email, password_hash, role, disabled, auth_version, preferred_model, admin_shared_api_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [user.id, user.email, user.password_hash, user.role, user.disabled, user.auth_version ?? 0, user.preferred_model ?? null, user.admin_shared_api_enabled ?? 0, user.created_at, user.updated_at]
  );
  return {
    id: user.id,
    email: user.email,
    role: user.role,
      disabled: user.disabled,
      auth_version: user.auth_version ?? 0,
      preferred_model: user.preferred_model ?? null,
      admin_shared_api_enabled: user.admin_shared_api_enabled ?? 0,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

export function updateUserRole(id: string, role: 'admin' | 'user'): boolean {
  const result = run(
    'UPDATE users SET role = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?',
    [role, new Date().toISOString(), id],
  );
  return result.changes > 0;
}

export function updateUserDisabled(id: string, disabled: number): boolean {
  const result = run(
    'UPDATE users SET disabled = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?',
    [disabled, new Date().toISOString(), id],
  );
  return result.changes > 0;
}

export function updateUserAdminApiSharing(id: string, enabled: number): boolean {
  const result = run(
    'UPDATE users SET admin_shared_api_enabled = ?, updated_at = ? WHERE id = ? AND role IN (\'admin\', \'user\')',
    [enabled ? 1 : 0, new Date().toISOString(), id],
  );
  return result.changes > 0;
}

export function updateUserLastLogin(id: string): boolean {
  const result = run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  return result.changes > 0;
}

export function getInviteCode(role: DbInviteCode['role']): DbInviteCode | undefined {
  return queryOne<DbInviteCode>('SELECT role, code_hash, created_at, rotated_at, version FROM invite_codes WHERE role = ?', [role]);
}

export function listInviteCodes(): DbInviteCode[] {
  return queryAll<DbInviteCode>(
    "SELECT role, code_hash, created_at, rotated_at, version FROM invite_codes ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END",
  );
}

export function upsertInviteCode(record: DbInviteCode): DbInviteCode {
  if (getInviteCode(record.role)) {
    run(
      'UPDATE invite_codes SET code_hash = ?, created_at = ?, rotated_at = ?, version = ? WHERE role = ?',
      [record.code_hash, record.created_at, record.rotated_at, record.version, record.role],
    );
  } else {
    run(
      'INSERT INTO invite_codes (role, code_hash, created_at, rotated_at, version) VALUES (?, ?, ?, ?, ?)',
      [record.role, record.code_hash, record.created_at, record.rotated_at, record.version],
    );
  }
  return getInviteCode(record.role) || record;
}

export function getUserPreferredModel(userId: string, fallback: string): string {
  const row = queryOne<{ preferred_model: string | null }>('SELECT preferred_model FROM users WHERE id = ?', [userId]);
  return row?.preferred_model?.trim() || fallback;
}

export function updateUserPreferredModel(userId: string, model: string): boolean {
  const result = run(
    'UPDATE users SET preferred_model = ?, updated_at = ? WHERE id = ?',
    [model, new Date().toISOString(), userId],
  );
  return result.changes > 0;
}

export function createEmailCode(code: DbEmailCode): void {
  run('DELETE FROM email_codes WHERE email = ? AND purpose = ?', [code.email, code.purpose]);
  run(
    'INSERT INTO email_codes (id, email, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [code.id, code.email, emailCodeDigest(code.email, code.purpose, code.code), code.purpose, code.expires_at, code.created_at]
  );
}

export function verifyEmailCode(email: string, code: string, purpose: string): DbEmailCode | undefined {
  const now = new Date().toISOString();
  const record = queryOne<DbEmailCode>(
    'SELECT * FROM email_codes WHERE email = ? AND purpose = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [email, purpose, now],
  );
  if (!record) return undefined;
  const expected = emailCodeDigest(email, purpose, code);
  const stored = String(record.code || '');
  const matches = stored.startsWith('hmac-sha256:')
    ? safeTextEqual(stored, expected)
    : safeTextEqual(stored, code); // 兼容迁移前尚未过期的验证码。
  return matches ? record : undefined;
}

function emailCodeDigest(email: string, purpose: string, code: string): string {
  const pepper = process.env.EMAIL_CODE_PEPPER || process.env.JWT_SECRET || 'dev-only-email-code-pepper';
  return 'hmac-sha256:' + crypto.createHmac('sha256', pepper)
    .update(`${email.toLowerCase()}\n${purpose}\n${code}`, 'utf8')
    .digest('hex');
}

function safeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function deleteEmailCode(email: string, purpose: string): void {
  run('DELETE FROM email_codes WHERE email = ? AND purpose = ?', [email, purpose]);
}

export function getReminder(userId: string): DbReminder | undefined {
  return queryOne<DbReminder>('SELECT * FROM reminders WHERE user_id = ?', [userId]);
}

export function upsertReminder(reminder: DbReminder): DbReminder {
  const existing = getReminder(reminder.user_id);
  const reminderEmail = reminder.reminder_email ?? existing?.reminder_email ?? null;
  const homeLocationName = reminder.home_location_name === undefined ? existing?.home_location_name ?? null : reminder.home_location_name;
  const homeLocationAdmin1 = reminder.home_location_admin1 === undefined ? existing?.home_location_admin1 ?? null : reminder.home_location_admin1;
  const homeLocationCountry = reminder.home_location_country === undefined ? existing?.home_location_country ?? null : reminder.home_location_country;
  const homeLatitude = reminder.home_latitude === undefined ? existing?.home_latitude ?? null : reminder.home_latitude;
  const homeLongitude = reminder.home_longitude === undefined ? existing?.home_longitude ?? null : reminder.home_longitude;
  const homeTimezone = reminder.home_timezone === undefined ? existing?.home_timezone ?? null : reminder.home_timezone;
  const dailyReportDeliverySources = reminder.daily_report_delivery_sources
    ?? existing?.daily_report_delivery_sources
    ?? '["local"]';
  if (existing) {
    run(
      `UPDATE reminders SET enabled = ?, hour = ?, minute = ?, reminder_email = ?, email_enabled = ?, report_email_enabled = ?, daily_report_delivery_sources = ?,
       in_app_enabled = ?, browser_enabled = ?, timezone = ?, quiet_hours_enabled = ?, quiet_start = ?, quiet_end = ?,
       home_location_name = ?, home_location_admin1 = ?, home_location_country = ?, home_latitude = ?, home_longitude = ?, home_timezone = ?,
       updated_at = ? WHERE user_id = ?`,
      [reminder.enabled, reminder.hour, reminder.minute, reminderEmail, reminder.email_enabled ?? existing.email_enabled ?? 1,
        reminder.report_email_enabled ?? existing.report_email_enabled ?? 0,
        dailyReportDeliverySources,
        reminder.in_app_enabled ?? existing.in_app_enabled ?? 1, reminder.browser_enabled ?? existing.browser_enabled ?? 1,
        reminder.timezone || existing.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? existing.quiet_hours_enabled ?? 0,
        reminder.quiet_start || existing.quiet_start || '22:00', reminder.quiet_end || existing.quiet_end || '08:00',
        homeLocationName, homeLocationAdmin1, homeLocationCountry, homeLatitude, homeLongitude, homeTimezone,
        reminder.updated_at, reminder.user_id]
    );
  } else {
    run(
      `INSERT INTO reminders (id, user_id, enabled, hour, minute, reminder_email, email_enabled, report_email_enabled, daily_report_delivery_sources, in_app_enabled,
       browser_enabled, timezone, quiet_hours_enabled, quiet_start, quiet_end, home_location_name, home_location_admin1,
       home_location_country, home_latitude, home_longitude, home_timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reminder.id, reminder.user_id, reminder.enabled, reminder.hour, reminder.minute, reminderEmail,
        reminder.email_enabled ?? 1, reminder.report_email_enabled ?? 0, dailyReportDeliverySources, reminder.in_app_enabled ?? 1, reminder.browser_enabled ?? 1,
        reminder.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? 0, reminder.quiet_start || '22:00',
        reminder.quiet_end || '08:00', homeLocationName, homeLocationAdmin1, homeLocationCountry, homeLatitude,
        homeLongitude, homeTimezone, reminder.created_at, reminder.updated_at]
    );
  }
  return {
    ...reminder,
    reminder_email: reminderEmail,
    report_email_enabled: reminder.report_email_enabled ?? existing?.report_email_enabled ?? 0,
    daily_report_delivery_sources: dailyReportDeliverySources,
    home_location_name: homeLocationName,
    home_location_admin1: homeLocationAdmin1,
    home_location_country: homeLocationCountry,
    home_latitude: homeLatitude,
    home_longitude: homeLongitude,
    home_timezone: homeTimezone,
  };
}

export function exportUserAccountData(userId: string): { user: Omit<DbUser, 'password_hash'> | null; reminder: DbReminder | null } {
  const user = getUserById(userId) || null;
  const reminder = getReminder(userId) || null;
  return { user, reminder };
}

export function exportChatDb(): Buffer {
  return Buffer.from(db.export());
}
export function getAllEnabledReminders(): (DbReminder & { email: string })[] {
  return queryAll<DbReminder & { email: string }>(
    `SELECT r.*, COALESCE(NULLIF(r.reminder_email, ''), u.email) AS email FROM reminders r JOIN users u ON r.user_id = u.id WHERE r.enabled = 1 AND u.disabled = 0`
  );
}

export function getReminderEmail(userId: string): string | null {
  const row = queryOne<{ reminder_email: string | null; email: string }>(
    `SELECT r.reminder_email, u.email FROM users u LEFT JOIN reminders r ON r.user_id = u.id WHERE u.id = ?`,
    [userId],
  );
  return row ? (row.reminder_email?.trim() || row.email) : null;
}

// ============= AI 记事条目操作 =============

export function getNoteItem(id: string, userId: string): DbNoteItem | undefined {
  return queryOne<DbNoteItem>('SELECT * FROM note_items WHERE id = ? AND user_id = ?', [id, userId]);
}

export function listNoteItems(userId: string): DbNoteItem[] {
  return queryAll<DbNoteItem>(
    'SELECT * FROM note_items WHERE user_id = ? ORDER BY completed ASC, updated_at DESC, created_at DESC',
    [userId],
  );
}

export function searchNoteItems(userId: string, query: string, limit = 100): DbNoteItem[] {
  const pattern = `%${escapeLike(query.trim())}%`;
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 100);
  return queryAll<DbNoteItem>(
    `SELECT * FROM note_items
     WHERE user_id = ? AND content LIKE ? ESCAPE '\\'
     ORDER BY completed ASC, updated_at DESC, created_at DESC
     LIMIT ?`,
    [userId, pattern, safeLimit],
  );
}

export function createNoteItem(item: DbNoteItem): DbNoteItem {
  run(
    `INSERT INTO note_items
     (id, user_id, content, completed, completed_at, color, linked_schedule_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.user_id, item.content, item.completed ? 1 : 0, item.completed_at, item.color || 'neutral', item.linked_schedule_ids || '[]', item.created_at, item.updated_at],
  );
  return item;
}

export function updateNoteItem(
  id: string,
  userId: string,
  updates: Partial<Pick<DbNoteItem, 'content' | 'completed' | 'completed_at' | 'color' | 'linked_schedule_ids' | 'updated_at'>>,
): DbNoteItem | undefined {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.completed !== undefined) {
    fields.push('completed = ?');
    values.push(updates.completed ? 1 : 0);
  }
  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }
  if (updates.color !== undefined) {
    fields.push('color = ?');
    values.push(updates.color);
  }
  if (updates.linked_schedule_ids !== undefined) {
    fields.push('linked_schedule_ids = ?');
    values.push(updates.linked_schedule_ids);
  }
  if (!fields.length) return getNoteItem(id, userId);
  fields.push('updated_at = ?');
  values.push(updates.updated_at || new Date().toISOString(), id, userId);
  run(`UPDATE note_items SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  return getNoteItem(id, userId);
}

export function deleteNoteItem(id: string, userId: string): boolean {
  return run('DELETE FROM note_items WHERE id = ? AND user_id = ?', [id, userId]).changes > 0;
}

// ============= Library / 知识库操作 =============

export interface DbLibraryListFilters {
  q?: string;
  kind?: string;
  type?: string;
  status?: string;
  tag?: string;
  source_type?: string;
  limit?: number;
  offset?: number;
  sort?: DbLibrarySort;
  fetchAll?: boolean;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

export function getLibraryPreference(userId: string): DbLibraryPreference | undefined {
  return queryOne<DbLibraryPreference>('SELECT user_id, sort, updated_at FROM library_preferences WHERE user_id = ?', [userId]);
}

export function upsertLibraryPreference(preference: DbLibraryPreference): DbLibraryPreference {
  const existing = getLibraryPreference(preference.user_id);
  if (existing) {
    run(
      'UPDATE library_preferences SET sort = ?, updated_at = ? WHERE user_id = ?',
      [preference.sort, preference.updated_at, preference.user_id],
    );
  } else {
    run(
      'INSERT INTO library_preferences (user_id, sort, updated_at) VALUES (?, ?, ?)',
      [preference.user_id, preference.sort, preference.updated_at],
    );
  }
  return getLibraryPreference(preference.user_id) || preference;
}

export function getLibraryEntry(id: string, userId: string): DbLibraryEntry | undefined {
  return queryOne<DbLibraryEntry>('SELECT * FROM library_entries WHERE id = ? AND user_id = ?', [id, userId]);
}

export function getLibraryEntryBySourceId(sourceId: string, userId: string): DbLibraryEntry | undefined {
  return queryOne<DbLibraryEntry>(
    'SELECT * FROM library_entries WHERE source_id = ? AND user_id = ? LIMIT 1',
    [sourceId, userId],
  );
}

export function listLibraryEntries(userId: string, filters: DbLibraryListFilters = {}): { items: DbLibraryEntry[]; total: number } {
  const clauses = ['user_id = ?'];
  const params: any[] = [userId];
  if (filters.kind && filters.kind !== 'all') {
    clauses.push('kind = ?');
    params.push(filters.kind);
  }
  if (filters.type && filters.type !== 'all') {
    clauses.push('type = ?');
    params.push(filters.type);
  }
  if (filters.status && filters.status !== 'all') {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.source_type && filters.source_type !== 'all') {
    clauses.push('source_type = ?');
    params.push(filters.source_type);
  }
  if (filters.tag) {
    clauses.push("tags_json LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeLike(filters.tag)}"%`);
  }
  if (filters.q?.trim()) {
    const pattern = `%${escapeLike(filters.q.trim())}%`;
    clauses.push("(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern, pattern);
  }
  const where = clauses.join(' AND ');
  const total = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM library_entries WHERE ${where}`, params)?.count || 0;
  const limit = Math.min(Math.max(Math.floor(filters.limit || 40), 1), 100);
  const offset = Math.max(Math.floor(filters.offset || 0), 0);
  const order = filters.sort === 'updated_asc'
    ? 'updated_at ASC, created_at ASC, id ASC'
    : filters.sort === 'created_asc'
      ? 'created_at ASC, id ASC'
      : filters.sort === 'created_desc'
        ? 'created_at DESC, id DESC'
        : 'updated_at DESC, created_at DESC, id DESC';
  const isTitleSort = filters.sort === 'title_asc' || filters.sort === 'title_desc';
  const items = filters.fetchAll || isTitleSort
    ? queryAll<DbLibraryEntry>(`SELECT * FROM library_entries WHERE ${where}`, params)
    : queryAll<DbLibraryEntry>(
        `SELECT * FROM library_entries WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );
  return { items, total: Number(total) };
}

export function createLibraryEntry(entry: DbLibraryEntry): DbLibraryEntry {
  run(
    `INSERT INTO library_entries
     (id, user_id, kind, type, source_id, slug, title, content, summary, tags_json, status,
      source_type, source_ref, source_url, metadata_json, relations_json, content_hash, created_at, updated_at, published_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.user_id,
      entry.kind,
      entry.type,
      entry.source_id,
      entry.slug,
      entry.title,
      entry.content,
      entry.summary,
      entry.tags_json,
      entry.status,
      entry.source_type,
      entry.source_ref,
      entry.source_url,
      entry.metadata_json,
      entry.relations_json,
      entry.content_hash,
      entry.created_at,
      entry.updated_at,
      entry.published_at,
      entry.archived_at,
    ],
  );
  return entry;
}

export function updateLibraryEntry(
  id: string,
  userId: string,
  updates: Partial<Pick<DbLibraryEntry, 'kind' | 'type' | 'source_id' | 'slug' | 'title' | 'content' | 'summary' | 'tags_json' | 'status' | 'source_type' | 'source_ref' | 'source_url' | 'metadata_json' | 'relations_json' | 'content_hash' | 'updated_at' | 'published_at' | 'archived_at'>>,
): DbLibraryEntry | undefined {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed = [
    'kind', 'type', 'source_id', 'slug', 'title', 'content', 'summary', 'tags_json', 'status',
    'source_type', 'source_ref', 'source_url', 'metadata_json', 'content_hash', 'updated_at',
    'published_at', 'archived_at', 'relations_json',
  ] as const;
  for (const field of allowed) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(updates[field]);
    }
  }
  if (!fields.length) return getLibraryEntry(id, userId);
  values.push(id, userId);
  run(`UPDATE library_entries SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  return getLibraryEntry(id, userId);
}

export function deleteLibraryEntry(id: string, userId: string): boolean {
  if (!getLibraryEntry(id, userId)) return false;
  run('DELETE FROM library_comments WHERE entry_id = ? AND user_id = ?', [id, userId]);
  run('DELETE FROM library_entry_versions WHERE entry_id = ? AND user_id = ?', [id, userId]);
  return run('DELETE FROM library_entries WHERE id = ? AND user_id = ?', [id, userId]).changes > 0;
}

export type LibraryLifecycleAction = 'retire' | 'restore' | 'purge';

export interface LibraryLifecycleResult {
  action: LibraryLifecycleAction;
  items: Array<{
    sourceId: string;
    status: 'RETIRED' | 'RESTORED' | 'PURGED' | 'UNCHANGED' | 'NOT_FOUND';
    entryId?: string;
  }>;
  cleanedRelationCount: number;
  touchedEntryCount: number;
}

function parseLibraryRelations(value: string): Array<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
      : [];
  } catch {
    return [];
  }
}

function relationTouchesSourceIds(relation: Record<string, unknown>, sourceIds: Set<string>): boolean {
  const sourceId = String(relation.sourceId || '').trim();
  const targetSourceId = String(relation.targetSourceId || '').trim();
  return sourceIds.has(sourceId) || sourceIds.has(targetSourceId);
}

function createRelationChangeVersion(row: DbLibraryEntry, relationsJson: string, createdAt: string): void {
  if (row.kind !== 'article') return;
  executeWithoutSave(
    `INSERT INTO library_entry_versions
     (id, entry_id, user_id, content_hash, title, summary, content, tags_json, relations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), row.id, row.user_id, row.content_hash, row.title, row.summary, row.content, row.tags_json, relationsJson, createdAt],
  );
}

export function applyLibraryLifecycle(userId: string, sourceIds: string[], action: LibraryLifecycleAction): LibraryLifecycleResult {
  const normalizedSourceIds = [...new Set(sourceIds.map(sourceId => String(sourceId || '').trim()).filter(Boolean))];
  if (!normalizedSourceIds.length) {
    return { action, items: [], cleanedRelationCount: 0, touchedEntryCount: 0 };
  }

  const placeholders = normalizedSourceIds.map(() => '?').join(', ');
  return runTransaction(() => {
    const rows = queryAll<DbLibraryEntry>(
      `SELECT * FROM library_entries WHERE user_id = ? AND source_id IN (${placeholders})`,
      [userId, ...normalizedSourceIds],
    );
    const rowBySourceId = new Map(rows.map(row => [row.source_id || '', row]));
    const targetSet = new Set(normalizedSourceIds);
    const now = new Date().toISOString();
    let cleanedRelationCount = 0;
    const touchedEntryIds = new Set<string>();

    if (action !== 'restore') {
      const allRows = queryAll<DbLibraryEntry>('SELECT * FROM library_entries WHERE user_id = ?', [userId]);
      for (const row of allRows) {
        const relations = parseLibraryRelations(row.relations_json);
        const remainingRelations = relations.filter(relation => !relationTouchesSourceIds(relation, targetSet));
        const removedCount = relations.length - remainingRelations.length;
        const isTarget = Boolean(row.source_id && targetSet.has(row.source_id));
        if (removedCount > 0) cleanedRelationCount += removedCount;

        if (action === 'retire' && isTarget) {
          const relationsJson = JSON.stringify(remainingRelations);
          const statusChanged = row.status !== 'archived' || row.archived_at === null;
          const relationChanged = relationsJson !== row.relations_json;
          if (statusChanged || relationChanged) {
            executeWithoutSave(
              `UPDATE library_entries
               SET status = 'archived', archived_at = COALESCE(archived_at, ?), relations_json = ?, updated_at = ?
               WHERE id = ? AND user_id = ?`,
              [now, relationsJson, now, row.id, userId],
            );
            if (relationChanged) createRelationChangeVersion(row, relationsJson, now);
            touchedEntryIds.add(row.id);
          }
        } else if (action === 'purge' && isTarget) {
          executeWithoutSave('DELETE FROM library_comments WHERE entry_id = ? AND user_id = ?', [row.id, userId]);
          executeWithoutSave('DELETE FROM library_entry_versions WHERE entry_id = ? AND user_id = ?', [row.id, userId]);
          executeWithoutSave('DELETE FROM library_entries WHERE id = ? AND user_id = ?', [row.id, userId]);
          touchedEntryIds.add(row.id);
        } else if (removedCount > 0) {
          const relationsJson = JSON.stringify(remainingRelations);
          executeWithoutSave(
            'UPDATE library_entries SET relations_json = ?, updated_at = ? WHERE id = ? AND user_id = ?',
            [relationsJson, now, row.id, userId],
          );
          createRelationChangeVersion(row, relationsJson, now);
          touchedEntryIds.add(row.id);
        }
      }
    } else {
      for (const row of rows) {
        if (row.status !== 'archived') continue;
        executeWithoutSave(
          "UPDATE library_entries SET status = 'active', archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
          [now, row.id, userId],
        );
        touchedEntryIds.add(row.id);
      }
    }

    const items = normalizedSourceIds.map(sourceId => {
      const row = rowBySourceId.get(sourceId);
      if (action === 'purge') return row
        ? { sourceId, status: 'PURGED' as const, entryId: row.id }
        : { sourceId, status: 'NOT_FOUND' as const };
      if (!row) return { sourceId, status: 'NOT_FOUND' as const };
      if (action === 'retire') return row.status === 'archived'
        ? { sourceId, status: 'UNCHANGED' as const, entryId: row.id }
        : { sourceId, status: 'RETIRED' as const, entryId: row.id };
      return row.status === 'archived'
        ? { sourceId, status: 'RESTORED' as const, entryId: row.id }
        : { sourceId, status: 'UNCHANGED' as const, entryId: row.id };
    });
    return { action, items, cleanedRelationCount, touchedEntryCount: touchedEntryIds.size };
  });
}

export function createLibraryEntryVersion(version: DbLibraryEntryVersion): DbLibraryEntryVersion {
  run(
    `INSERT INTO library_entry_versions
     (id, entry_id, user_id, content_hash, title, summary, content, tags_json, relations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [version.id, version.entry_id, version.user_id, version.content_hash, version.title, version.summary, version.content, version.tags_json, version.relations_json, version.created_at],
  );
  return version;
}

export function listLibraryEntryVersions(entryId: string, userId: string): DbLibraryEntryVersion[] {
  return queryAll<DbLibraryEntryVersion>(
    `SELECT v.* FROM library_entry_versions v
     JOIN library_entries e ON e.id = v.entry_id
     WHERE v.entry_id = ? AND v.user_id = ? AND e.user_id = ?
     ORDER BY v.created_at DESC, v.id DESC`,
    [entryId, userId, userId],
  );
}

export function listLibraryComments(entryId: string, userId: string): DbLibraryComment[] {
  return queryAll<DbLibraryComment>(
    `SELECT c.* FROM library_comments c
     JOIN library_entries e ON e.id = c.entry_id
     WHERE c.entry_id = ? AND c.user_id = ? AND e.user_id = ?
     ORDER BY c.created_at ASC, c.id ASC`,
    [entryId, userId, userId],
  );
}

export function createLibraryComment(comment: DbLibraryComment): DbLibraryComment {
  run(
    `INSERT INTO library_comments (id, entry_id, user_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [comment.id, comment.entry_id, comment.user_id, comment.content, comment.created_at, comment.updated_at],
  );
  return comment;
}

export function deleteLibraryComment(id: string, entryId: string, userId: string): boolean {
  return run(
    'DELETE FROM library_comments WHERE id = ? AND entry_id = ? AND user_id = ?',
    [id, entryId, userId],
  ).changes > 0;
}

export function getLibraryPublishToken(userId: string): DbLibraryPublishToken | undefined {
  return queryOne<DbLibraryPublishToken>('SELECT * FROM library_publish_tokens WHERE user_id = ?', [userId]);
}

export function replaceLibraryPublishToken(token: DbLibraryPublishToken): DbLibraryPublishToken {
  run('DELETE FROM library_publish_tokens WHERE user_id = ?', [token.user_id]);
  run(
    `INSERT INTO library_publish_tokens
     (id, user_id, token_hash, token_prefix, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [token.id, token.user_id, token.token_hash, token.token_prefix, token.created_at, token.last_used_at, token.revoked_at],
  );
  return token;
}

export function revokeLibraryPublishToken(userId: string, revokedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE library_publish_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    [revokedAt, userId],
  ).changes > 0;
}

export function findActiveLibraryPublishTokenByHash(tokenHash: string): DbLibraryPublishToken | undefined {
  return queryOne<DbLibraryPublishToken>(
    `SELECT t.* FROM library_publish_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
    [tokenHash],
  );
}

export function markLibraryPublishTokenUsed(id: string, usedAt = new Date().toISOString()): void {
  run('UPDATE library_publish_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL', [usedAt, id]);
}

export function exportUserLibraryEntries(userId: string): DbLibraryEntry[] {
  return queryAll<DbLibraryEntry>('SELECT * FROM library_entries WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [userId]);
}

export function restoreUserLibraryEntries(
  userId: string,
  rows: Array<Partial<DbLibraryEntry> & { sourceId?: unknown; sourceType?: unknown; sourceRef?: unknown; sourceUrl?: unknown; tags?: unknown; metadata?: unknown; relations?: unknown }>,
  mode: 'merge' | 'replace',
): { entries: number; versions: number } {
  if (mode === 'replace') {
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
  }
  let entries = 0;
  let versions = 0;
  for (const row of rows || []) {
    const id = String(row.id || '').trim() || crypto.randomUUID();
    if (getLibraryEntry(id, userId)) continue;
    const sourceId = String(row.source_id ?? row.sourceId ?? '').trim() || null;
    if (sourceId && getLibraryEntryBySourceId(sourceId, userId)) continue;
    const now = new Date().toISOString();
    const kind = row.kind === 'article' ? 'article' : 'fragment';
    const typeValues = ['knowledge', 'insight', 'framework', 'experience', 'tutorial', 'reference'] as const;
    const type = (typeValues as readonly string[]).includes(String(row.type)) ? String(row.type) as DbLibraryEntry['type'] : 'knowledge';
    const statusValues = ['draft', 'active', 'archived'] as const;
    const status = (statusValues as readonly string[]).includes(String(row.status)) ? String(row.status) as DbLibraryEntry['status'] : 'active';
    const content = String(row.content || '').trim();
    if (!content) continue;
    const tags = Array.isArray(row.tags)
      ? row.tags
      : typeof row.tags_json === 'string'
        ? (() => { try { return JSON.parse(row.tags_json); } catch { return []; } })()
        : [];
    const entry: DbLibraryEntry = {
      id,
      user_id: userId,
      kind,
      type,
      source_id: sourceId,
      slug: String(row.slug || '').trim() || null,
      title: String(row.title || '').trim() || null,
      content,
      summary: String(row.summary || '').trim(),
      tags_json: JSON.stringify(Array.isArray(tags) ? tags.map(tag => String(tag || '').trim()).filter(Boolean).slice(0, 50) : []),
      status,
      source_type: String(row.source_type ?? row.sourceType ?? 'manual').trim() || 'manual',
      source_ref: String(row.source_ref ?? row.sourceRef ?? '').trim() || null,
      source_url: String(row.source_url ?? row.sourceUrl ?? '').trim() || null,
      metadata_json: typeof row.metadata_json === 'string'
        ? row.metadata_json
        : JSON.stringify(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
      relations_json: typeof row.relations_json === 'string'
        ? row.relations_json
        : JSON.stringify(Array.isArray(row.relations) ? row.relations : []),
      content_hash: String(row.content_hash || crypto.createHash('sha256').update(content, 'utf8').digest('hex')),
      created_at: String(row.created_at || now),
      updated_at: String(row.updated_at || now),
      published_at: String(row.published_at || '').trim() || null,
      archived_at: String(row.archived_at || '').trim() || null,
    };
    createLibraryEntry(entry);
    entries++;
    if (kind === 'article') {
      createLibraryEntryVersion({
        id: crypto.randomUUID(),
        entry_id: id,
        user_id: userId,
        content_hash: entry.content_hash,
        title: entry.title,
        summary: entry.summary,
        content: entry.content,
        tags_json: entry.tags_json,
        relations_json: entry.relations_json,
        created_at: entry.updated_at,
      });
      versions++;
    }
  }
  return { entries, versions };
}

function restoreLinkedScheduleIds(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  return Array.isArray(parsed)
    ? [...new Set(parsed.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 100)
    : [];
}

export function exportUserNoteItems(userId: string): DbNoteItem[] {
  return listNoteItems(userId);
}

export function restoreUserNoteItems(
  userId: string,
  rows: Array<Partial<DbNoteItem> & { linkedScheduleIds?: unknown; completedAt?: unknown; color?: unknown }>,
  mode: 'merge' | 'replace',
): { items: number } {
  if (mode === 'replace') run('DELETE FROM note_items WHERE user_id = ?', [userId]);
  let items = 0;
  for (const row of rows || []) {
    const content = String(row.content || '').trim().slice(0, 2_000);
    if (!content) continue;
    const id = String(row.id || '').trim() || crypto.randomUUID();
    if (getNoteItem(id, userId)) continue;
    const now = new Date().toISOString();
    const rawRow = row as any;
    const completed = rawRow.completed === true || Number(rawRow.completed) === 1;
    const updatedAt = String(rawRow.updated_at || rawRow.updatedAt || now);
    const createdAt = String(rawRow.created_at || rawRow.createdAt || updatedAt);
    const completedAt = completed
      ? String(rawRow.completed_at || rawRow.completedAt || updatedAt)
      : null;
    const colorValues = ['neutral', 'purple', 'blue', 'green', 'amber', 'rose'] as const;
    const colorValue = String(rawRow.color || 'neutral');
    const color = (colorValues as readonly string[]).includes(colorValue) ? colorValue : 'neutral';
    createNoteItem({
      id,
      user_id: userId,
      content,
      completed: completed ? 1 : 0,
      completed_at: completedAt,
      color,
      linked_schedule_ids: JSON.stringify(restoreLinkedScheduleIds(row.linked_schedule_ids ?? row.linkedScheduleIds)),
      created_at: createdAt,
      updated_at: updatedAt,
    });
    items++;
  }
  return { items };
}
// ============= 用户 API Key 操作 =============

export function getUserApiKey(userId: string): DbUserApiKey | undefined {
  return queryOne<DbUserApiKey>('SELECT * FROM user_api_keys WHERE user_id = ?', [userId]);
}

export function getAdminSharedApiKey(): DbUserApiKey | undefined {
  return queryOne<DbUserApiKey>(
    `SELECT k.* FROM user_api_keys k
     JOIN users u ON u.id = k.user_id
     WHERE u.role = 'admin' AND u.disabled = 0
     ORDER BY u.created_at ASC
     LIMIT 1`,
  );
}

export function upsertUserApiKey(apiKey: DbUserApiKey): DbUserApiKey {
  const existing = getUserApiKey(apiKey.user_id);
  const now = new Date().toISOString();

  // 确保 base_url 不是 undefined（sql.js 不允许 undefined）
  const baseUrl = apiKey.base_url ?? null;

  if (existing) {
    run(
      'UPDATE user_api_keys SET api_key = ?, base_url = ?, updated_at = ? WHERE user_id = ?',
      [apiKey.api_key, baseUrl, now, apiKey.user_id]
    );
  } else {
    run(
      'INSERT INTO user_api_keys (id, user_id, api_key, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [apiKey.id, apiKey.user_id, apiKey.api_key, baseUrl, now, now]
    );
  }

  return { ...apiKey, base_url: baseUrl, updated_at: now };
}

export function deleteUserApiKey(userId: string): boolean {
  const result = run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
  return result.changes > 0;
}

// ============= 用户邮箱账号操作 =============

export function getUserMailAccount(userId: string): DbUserMailAccount | undefined {
  return queryOne<DbUserMailAccount>('SELECT * FROM user_mail_accounts WHERE user_id = ?', [userId]);
}

export function upsertUserMailAccount(account: DbUserMailAccount): DbUserMailAccount {
  const existing = getUserMailAccount(account.user_id);
  const now = account.updated_at || new Date().toISOString();
  if (existing) {
    run(
      `UPDATE user_mail_accounts SET provider = ?, username = ?, encrypted_auth_code = ?, enabled = ?, updated_at = ?
       WHERE user_id = ?`,
      [account.provider, account.username, account.encrypted_auth_code, account.enabled, now, account.user_id],
    );
  } else {
    run(
      `INSERT INTO user_mail_accounts
       (id, user_id, provider, username, encrypted_auth_code, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [account.id, account.user_id, account.provider, account.username, account.encrypted_auth_code, account.enabled, account.created_at, now],
    );
  }
  return { ...account, updated_at: now };
}

export function deleteUserMailAccount(userId: string): boolean {
  return run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]).changes > 0;
}

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

// ============= ChatGPT Work Cloud 日报数据 =============

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

// ============= Cloud 日报媒体准备批次 =============

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

// ============= OAuth 2.1 / MCP 授权记录 =============

export function createOAuthClient(client: DbOAuthClient): DbOAuthClient {
  run(
    `INSERT INTO oauth_clients
     (client_id, client_name, redirect_uris_json, grant_types_json, response_types_json,
      token_endpoint_auth_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.client_id,
      client.client_name,
      client.redirect_uris_json,
      client.grant_types_json,
      client.response_types_json,
      client.token_endpoint_auth_method,
      client.created_at,
      client.updated_at,
    ],
  );
  return client;
}

export function getOAuthClient(clientId: string): DbOAuthClient | undefined {
  return queryOne<DbOAuthClient>('SELECT * FROM oauth_clients WHERE client_id = ?', [clientId]);
}

export function createOAuthAuthorizationRequest(request: DbOAuthAuthorizationRequest): DbOAuthAuthorizationRequest {
  run(
    `INSERT INTO oauth_authorization_requests
     (id, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method,
      resource, csrf_hash, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      request.id,
      request.client_id,
      request.redirect_uri,
      request.scope,
      request.state,
      request.code_challenge,
      request.code_challenge_method,
      request.resource,
      request.csrf_hash,
      request.user_id,
      request.expires_at,
      request.created_at,
    ],
  );
  return request;
}

export function getOAuthAuthorizationRequest(id: string): DbOAuthAuthorizationRequest | undefined {
  return queryOne<DbOAuthAuthorizationRequest>('SELECT * FROM oauth_authorization_requests WHERE id = ?', [id]);
}

export function setOAuthAuthorizationRequestUser(id: string, userId: string): boolean {
  return run('UPDATE oauth_authorization_requests SET user_id = ? WHERE id = ?', [userId, id]).changes > 0;
}

export function setOAuthAuthorizationRequestScope(id: string, scope: string): boolean {
  return run('UPDATE oauth_authorization_requests SET scope = ? WHERE id = ?', [scope, id]).changes > 0;
}

export function deleteOAuthAuthorizationRequest(id: string): boolean {
  return run('DELETE FROM oauth_authorization_requests WHERE id = ?', [id]).changes > 0;
}

export function createOAuthAuthorizationCode(code: DbOAuthAuthorizationCode): DbOAuthAuthorizationCode {
  run(
    `INSERT INTO oauth_authorization_codes
     (code_hash, client_id, user_id, redirect_uri, scope, code_challenge,
      code_challenge_method, resource, expires_at, created_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code.code_hash,
      code.client_id,
      code.user_id,
      code.redirect_uri,
      code.scope,
      code.code_challenge,
      code.code_challenge_method,
      code.resource,
      code.expires_at,
      code.created_at,
      code.used_at,
    ],
  );
  return code;
}

export function getOAuthAuthorizationCode(codeHash: string): DbOAuthAuthorizationCode | undefined {
  return queryOne<DbOAuthAuthorizationCode>('SELECT * FROM oauth_authorization_codes WHERE code_hash = ?', [codeHash]);
}

export function markOAuthAuthorizationCodeUsed(codeHash: string, usedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_authorization_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL',
    [usedAt, codeHash],
  ).changes > 0;
}

export function createOAuthAccessToken(token: DbOAuthAccessToken): DbOAuthAccessToken {
  run(
    `INSERT INTO oauth_access_tokens
     (token_hash, client_id, user_id, scope, resource, expires_at, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [token.token_hash, token.client_id, token.user_id, token.scope, token.resource, token.expires_at, token.created_at, token.last_used_at, token.revoked_at],
  );
  return token;
}

export function getActiveOAuthAccessToken(tokenHash: string): DbOAuthAccessToken | undefined {
  return queryOne<DbOAuthAccessToken>(
    `SELECT t.* FROM oauth_access_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
    [tokenHash],
  );
}

export function markOAuthAccessTokenUsed(tokenHash: string, usedAt = new Date().toISOString()): void {
  run(
    'UPDATE oauth_access_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [usedAt, tokenHash],
  );
}

export function revokeOAuthAccessToken(tokenHash: string, revokedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_access_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [revokedAt, tokenHash],
  ).changes > 0;
}

export function createOAuthRefreshToken(token: DbOAuthRefreshToken): DbOAuthRefreshToken {
  run(
    `INSERT INTO oauth_refresh_tokens
     (token_hash, family_id, client_id, user_id, scope, resource, expires_at, created_at,
      last_used_at, revoked_at, rotated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token.token_hash,
      token.family_id,
      token.client_id,
      token.user_id,
      token.scope,
      token.resource,
      token.expires_at,
      token.created_at,
      token.last_used_at,
      token.revoked_at,
      token.rotated_at,
    ],
  );
  return token;
}

export function getActiveOAuthRefreshToken(tokenHash: string): DbOAuthRefreshToken | undefined {
  return queryOne<DbOAuthRefreshToken>(
    `SELECT t.* FROM oauth_refresh_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
    [tokenHash],
  );
}

export function getActiveOAuthRefreshTokenForClientUser(clientId: string, userId: string): DbOAuthRefreshToken | undefined {
  return queryOne<DbOAuthRefreshToken>(
    `SELECT * FROM oauth_refresh_tokens
     WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
       AND (' ' || scope || ' ') LIKE '% offline_access %'
     ORDER BY created_at DESC
     LIMIT 1`,
    [clientId, userId, new Date().toISOString()],
  );
}

export function getOAuthRefreshToken(tokenHash: string): DbOAuthRefreshToken | undefined {
  return queryOne<DbOAuthRefreshToken>('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?', [tokenHash]);
}

export function markOAuthRefreshTokenUsed(tokenHash: string, usedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_refresh_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [usedAt, tokenHash],
  ).changes > 0;
}

export function revokeOAuthRefreshFamily(familyId: string, revokedAt = new Date().toISOString()): number {
  return run(
    'UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
    [revokedAt, familyId],
  ).changes;
}

export function revokeOAuthRefreshToken(tokenHash: string, revokedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [revokedAt, tokenHash],
  ).changes > 0;
}

export function deleteDailyReportCloudData(userId: string): void {
  run('DELETE FROM daily_report_cloud_contexts WHERE user_id = ?', [userId]);
  run('DELETE FROM daily_report_cloud_activity WHERE user_id = ?', [userId]);
}

export function deleteOAuthUserData(userId: string): void {
  run('DELETE FROM oauth_authorization_requests WHERE user_id = ?', [userId]);
  run('DELETE FROM oauth_authorization_codes WHERE user_id = ?', [userId]);
  run('DELETE FROM oauth_access_tokens WHERE user_id = ?', [userId]);
  run('DELETE FROM oauth_refresh_tokens WHERE user_id = ?', [userId]);
}

export function deleteUser(userId: string): boolean {
  try {
    run('DELETE FROM daily_report_tokens WHERE user_id = ?', [userId]);
    deleteDailyReportCloudData(userId);
    deleteOAuthUserData(userId);
    run('DELETE FROM library_preferences WHERE user_id = ?', [userId]);
    run('DELETE FROM library_publish_tokens WHERE user_id = ?', [userId]);
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
    run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
    run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]);
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
    run('DELETE FROM ai_schedule_messages WHERE user_id = ?', [userId]);
    run('DELETE FROM note_items WHERE user_id = ?', [userId]);
    const sessions = queryAll<{ id: string }>('SELECT id FROM sessions WHERE user_id = ?', [userId]);
    for (const session of sessions) {
      run('DELETE FROM messages WHERE session_id = ?', [session.id]);
    }
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    const result = run('DELETE FROM users WHERE id = ?', [userId]);
    return result.changes > 0;
  } catch (error) {
    console.error('[DB] Delete user error:', error);
    return false;
  }
}

export function clearUserData(userId: string): { schedules: number; sessions: number } {
  try {
    run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
    run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]);
    deleteDailyReportCloudData(userId);
    deleteOAuthUserData(userId);
    run('DELETE FROM library_preferences WHERE user_id = ?', [userId]);
    run('DELETE FROM library_publish_tokens WHERE user_id = ?', [userId]);
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
    run('DELETE FROM ai_schedule_messages WHERE user_id = ?', [userId]);
    run('DELETE FROM note_items WHERE user_id = ?', [userId]);
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
    const sessions = queryAll<{ id: string }>('SELECT id FROM sessions WHERE user_id = ?', [userId]);
    for (const session of sessions) run('DELETE FROM messages WHERE session_id = ?', [session.id]);
    run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    return { schedules: 0, sessions: sessions.length };
  } catch (error) {
    console.error('[DB] Clear user data error:', error);
    return { schedules: 0, sessions: 0 };
  }
}

// 导出数据库初始化函数
export { initDb };

// 导出默认数据库访问（异步初始化后可用）
export default { initDb };
