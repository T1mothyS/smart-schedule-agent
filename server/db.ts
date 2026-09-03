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
      created_at TEXT NOT NULL
    )
  `);

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

  // 创建索引
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ai_schedule_messages_user_created ON ai_schedule_messages(user_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_token_hash ON daily_report_tokens(token_hash)');
  db.run('CREATE INDEX IF NOT EXISTS idx_note_items_user_updated ON note_items(user_id, updated_at)');

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
      (id, user_id, role, type, content, intent, schedule_items, plan, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.user_id,
      message.role,
      message.type,
      message.content,
      message.intent,
      message.schedule_items,
      message.plan,
      message.created_at,
    ],
  );
  return message;
}

export function updateAiScheduleMessage(
  id: string,
  userId: string,
  updates: Partial<Pick<DbAiScheduleMessage, 'type' | 'content' | 'intent' | 'schedule_items' | 'plan'>>,
): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  for (const field of ['type', 'content', 'intent', 'schedule_items', 'plan'] as const) {
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
    'UPDATE users SET admin_shared_api_enabled = ?, updated_at = ? WHERE id = ? AND role = \'user\'',
    [enabled ? 1 : 0, new Date().toISOString(), id],
  );
  return result.changes > 0;
}

export function updateUserLastLogin(id: string): boolean {
  const result = run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  return result.changes > 0;
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
  if (existing) {
    run(
      `UPDATE reminders SET enabled = ?, hour = ?, minute = ?, reminder_email = ?, email_enabled = ?, report_email_enabled = ?,
       in_app_enabled = ?, browser_enabled = ?, timezone = ?, quiet_hours_enabled = ?, quiet_start = ?, quiet_end = ?,
       home_location_name = ?, home_location_admin1 = ?, home_location_country = ?, home_latitude = ?, home_longitude = ?, home_timezone = ?,
       updated_at = ? WHERE user_id = ?`,
      [reminder.enabled, reminder.hour, reminder.minute, reminderEmail, reminder.email_enabled ?? existing.email_enabled ?? 1,
        reminder.report_email_enabled ?? existing.report_email_enabled ?? 0,
        reminder.in_app_enabled ?? existing.in_app_enabled ?? 1, reminder.browser_enabled ?? existing.browser_enabled ?? 1,
        reminder.timezone || existing.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? existing.quiet_hours_enabled ?? 0,
        reminder.quiet_start || existing.quiet_start || '22:00', reminder.quiet_end || existing.quiet_end || '08:00',
        homeLocationName, homeLocationAdmin1, homeLocationCountry, homeLatitude, homeLongitude, homeTimezone,
        reminder.updated_at, reminder.user_id]
    );
  } else {
    run(
      `INSERT INTO reminders (id, user_id, enabled, hour, minute, reminder_email, email_enabled, report_email_enabled, in_app_enabled,
       browser_enabled, timezone, quiet_hours_enabled, quiet_start, quiet_end, home_location_name, home_location_admin1,
       home_location_country, home_latitude, home_longitude, home_timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reminder.id, reminder.user_id, reminder.enabled, reminder.hour, reminder.minute, reminderEmail,
        reminder.email_enabled ?? 1, reminder.report_email_enabled ?? 0, reminder.in_app_enabled ?? 1, reminder.browser_enabled ?? 1,
        reminder.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? 0, reminder.quiet_start || '22:00',
        reminder.quiet_end || '08:00', homeLocationName, homeLocationAdmin1, homeLocationCountry, homeLatitude,
        homeLongitude, homeTimezone, reminder.created_at, reminder.updated_at]
    );
  }
  return {
    ...reminder,
    reminder_email: reminderEmail,
    report_email_enabled: reminder.report_email_enabled ?? existing?.report_email_enabled ?? 0,
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

export function deleteUser(userId: string): boolean {
  try {
    run('DELETE FROM daily_report_tokens WHERE user_id = ?', [userId]);
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
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
    run('DELETE FROM ai_schedule_messages WHERE user_id = ?', [userId]);
    run('DELETE FROM note_items WHERE user_id = ?', [userId]);
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
