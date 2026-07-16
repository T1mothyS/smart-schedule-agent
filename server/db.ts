import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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

// 初始化数据库
async function initDb(): Promise<void> {
  const SQL = await initSqlJs();

  // 尝试加载已有数据库
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 启用 WAL 模式
  db.run('PRAGMA journal_mode = WAL');

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
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
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
      in_app_enabled INTEGER NOT NULL DEFAULT 1,
      browser_enabled INTEGER NOT NULL DEFAULT 1,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_start TEXT NOT NULL DEFAULT '22:00',
      quiet_end TEXT NOT NULL DEFAULT '08:00',
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
    ['in_app_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['browser_enabled', "INTEGER NOT NULL DEFAULT 1"],
    ['timezone', "TEXT NOT NULL DEFAULT 'Asia/Shanghai'"],
    ['quiet_hours_enabled', "INTEGER NOT NULL DEFAULT 0"],
    ['quiet_start', "TEXT NOT NULL DEFAULT '22:00'"],
    ['quiet_end', "TEXT NOT NULL DEFAULT '08:00'"],
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

  // 创建索引
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email)');

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

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  disabled: number;
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
  in_app_enabled?: number;
  browser_enabled?: number;
  timezone?: string;
  quiet_hours_enabled?: number;
  quiet_start?: string;
  quiet_end?: string;
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

export function clearAllData(): void {
  run('DELETE FROM messages');
  run('DELETE FROM sessions');
}

// ============= 用户操作 =============

type PublicDbUser = Omit<DbUser, 'password_hash' | 'disabled' | 'last_login_at'> & { disabled: boolean; last_login_at: string | null };

export function getAllUsers(): PublicDbUser[] {
  const users = queryAll<any>('SELECT id, email, role, disabled, created_at, updated_at, last_login_at FROM users ORDER BY created_at DESC');
  return users.map(u => ({
    ...u,
    disabled: Boolean(u.disabled),
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
    `SELECT id, email, role, disabled, created_at, updated_at, last_login_at FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    users: users.map(u => ({
      ...u,
      disabled: Boolean(u.disabled),
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
  return queryOne<Omit<DbUser, 'password_hash'>>('SELECT id, email, role, disabled, created_at, updated_at FROM users WHERE id = ?', [id]);
}

export function createUser(user: DbUser): Omit<DbUser, 'password_hash'> {
  run(
    'INSERT INTO users (id, email, password_hash, role, disabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, user.email, user.password_hash, user.role, user.disabled, user.created_at, user.updated_at]
  );
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

export function updateUserRole(id: string, role: 'admin' | 'user'): boolean {
  const result = run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, new Date().toISOString(), id]);
  return result.changes > 0;
}

export function updateUserDisabled(id: string, disabled: number): boolean {
  const result = run('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?', [disabled, new Date().toISOString(), id]);
  return result.changes > 0;
}

export function updateUserLastLogin(id: string): boolean {
  const result = run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  return result.changes > 0;
}

export function createEmailCode(code: DbEmailCode): void {
  run('DELETE FROM email_codes WHERE email = ? AND purpose = ?', [code.email, code.purpose]);
  run(
    'INSERT INTO email_codes (id, email, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [code.id, code.email, code.code, code.purpose, code.expires_at, code.created_at]
  );
}

export function verifyEmailCode(email: string, code: string, purpose: string): DbEmailCode | undefined {
  const now = new Date().toISOString();
  return queryOne<DbEmailCode>(
    'SELECT * FROM email_codes WHERE email = ? AND code = ? AND purpose = ? AND expires_at > ?',
    [email, code, purpose, now]
  );
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
  if (existing) {
    run(
      `UPDATE reminders SET enabled = ?, hour = ?, minute = ?, reminder_email = ?, email_enabled = ?,
       in_app_enabled = ?, browser_enabled = ?, timezone = ?, quiet_hours_enabled = ?, quiet_start = ?, quiet_end = ?, updated_at = ? WHERE user_id = ?`,
      [reminder.enabled, reminder.hour, reminder.minute, reminderEmail, reminder.email_enabled ?? existing.email_enabled ?? 1,
        reminder.in_app_enabled ?? existing.in_app_enabled ?? 1, reminder.browser_enabled ?? existing.browser_enabled ?? 1,
        reminder.timezone || existing.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? existing.quiet_hours_enabled ?? 0,
        reminder.quiet_start || existing.quiet_start || '22:00', reminder.quiet_end || existing.quiet_end || '08:00',
        reminder.updated_at, reminder.user_id]
    );
  } else {
    run(
      `INSERT INTO reminders (id, user_id, enabled, hour, minute, reminder_email, email_enabled, in_app_enabled,
       browser_enabled, timezone, quiet_hours_enabled, quiet_start, quiet_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reminder.id, reminder.user_id, reminder.enabled, reminder.hour, reminder.minute, reminderEmail,
        reminder.email_enabled ?? 1, reminder.in_app_enabled ?? 1, reminder.browser_enabled ?? 1,
        reminder.timezone || 'Asia/Shanghai', reminder.quiet_hours_enabled ?? 0, reminder.quiet_start || '22:00',
        reminder.quiet_end || '08:00', reminder.created_at, reminder.updated_at]
    );
  }
  return { ...reminder, reminder_email: reminderEmail };
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
// ============= 用户 API Key 操作 =============

export function getUserApiKey(userId: string): DbUserApiKey | undefined {
  return queryOne<DbUserApiKey>('SELECT * FROM user_api_keys WHERE user_id = ?', [userId]);
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

export function deleteUser(userId: string): boolean {
  try {
    run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
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
    run('DELETE FROM reminders WHERE user_id = ?', [userId]);
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
