/**
 * 日程数据存储模块
 * 使用 sql.js 存储日程数据
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'schedule.db');

function snapshotBeforeMigration(label: string): void {
  if (!fs.existsSync(DB_PATH)) return;
  const dir = path.join(DATA_DIR, 'migration-backups');
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DB_PATH, path.join(dir, 'schedule-' + label + '-' + timestamp + '.db'));
}

// 确保 data 目录存在
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 数据库实例
let db: SqlJsDatabase;

// 初始化数据库
async function initScheduleDb(): Promise<void> {
  const SQL = await initSqlJs();

  // 尝试加载已有数据库
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 创建日历表（多日程表支持）
  db.run(`
    CREATE TABLE IF NOT EXISTS calendars (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3B82F6',
      icon TEXT DEFAULT '📅',
      is_visible INTEGER DEFAULT 1,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  // 插入默认日程表
  const now0 = new Date().toISOString();
  db.run(
    'INSERT OR IGNORE INTO calendars (id, name, color, icon, is_visible, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['personal', '个人', '#3B82F6', '👤', 1, 1, now0]
  );
  db.run(
    'INSERT OR IGNORE INTO calendars (id, name, color, icon, is_visible, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['work', '工作', '#8B5CF6', '💼', 1, 0, now0]
  );
  db.run(
    'INSERT OR IGNORE INTO calendars (id, name, color, icon, is_visible, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['family', '家庭', '#10B981', '🏠', 1, 0, now0]
  );

  // 创建日程表（支持日程 + 待办两种类型）
  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT 'default',
      calendar_id TEXT DEFAULT 'personal',
      type TEXT DEFAULT 'event',
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      all_day INTEGER DEFAULT 0,
      is_unscheduled INTEGER DEFAULT 0,
      location TEXT,
      notes TEXT,
      category TEXT DEFAULT 'other',
      priority TEXT DEFAULT 'medium',
      is_completed INTEGER DEFAULT 0,
      is_repeated INTEGER DEFAULT 0,
      repeat_rule TEXT,
      reminders TEXT,
      is_high_risk INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // 迁移：为已有表添加缺少的字段
  try { db.run(`ALTER TABLE schedules ADD COLUMN user_id TEXT DEFAULT 'default'`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN type TEXT DEFAULT 'event'`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN all_day INTEGER DEFAULT 0`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN is_unscheduled INTEGER DEFAULT 0`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN notes TEXT`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN calendar_id TEXT DEFAULT 'personal'`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN is_high_risk INTEGER DEFAULT 0`); } catch {}

  // 创建分类表
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3B82F6',
      icon TEXT DEFAULT '📌',
      created_at TEXT NOT NULL
    )
  `);

  const calendarColumns = queryAll<{ name: string }>('PRAGMA table_info(calendars)');
  const categoryColumns = queryAll<{ name: string }>('PRAGMA table_info(categories)');
  if (!calendarColumns.some(column => column.name === 'user_id') || !categoryColumns.some(column => column.name === 'user_id')) {
    snapshotBeforeMigration('user-ownership');
  }
  if (!calendarColumns.some(column => column.name === 'user_id')) db.run('ALTER TABLE calendars ADD COLUMN user_id TEXT');
  if (!categoryColumns.some(column => column.name === 'user_id')) db.run('ALTER TABLE categories ADD COLUMN user_id TEXT');
  db.run('CREATE INDEX IF NOT EXISTS idx_calendars_user ON calendars(user_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id, created_at)');

  // 插入默认分类
  const defaultCategories = [
    { id: 'work', name: '工作', color: '#3B82F6', icon: '💼' },
    { id: 'life', name: '生活', color: '#10B981', icon: '🏠' },
    { id: 'travel', name: '出行', color: '#F59E0B', icon: '🚗' },
    { id: 'social', name: '社交', color: '#EC4899', icon: '🤝' },
    { id: 'health', name: '健康', color: '#EF4444', icon: '❤️' },
    { id: 'other', name: '其他', color: '#6B7280', icon: '📌' }
  ];

  for (const cat of defaultCategories) {
    db.run(
      'INSERT OR IGNORE INTO categories (id, name, color, icon, created_at) VALUES (?, ?, ?, ?, ?)',
      [cat.id, cat.name, cat.color, cat.icon, new Date().toISOString()]
    );
  }

  // 保存到文件
  saveScheduleDb();

  console.log('[ScheduleDB] Schedule database initialized with sql.js');
}

// 保存数据库到文件
function saveScheduleDb(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
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
  saveScheduleDb();
  return { changes };
}

// 日程表（Calendar）接口
export interface Calendar {
  id: string;
  user_id?: string | null;
  name: string;
  color: string;
  icon: string;
  is_visible: boolean;
  is_default: boolean;
  created_at: string;
}

// 日程接口
export interface Schedule {
  id: string;
  user_id: string;
  calendar_id: string;
  type: 'event' | 'todo';
  title: string;
  description?: string;
  start_time: string;
  end_time?: string;
  all_day: boolean;
  is_unscheduled?: boolean;
  location?: string;
  notes?: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  is_completed: boolean;
  is_repeated: boolean;
  repeat_rule?: string;
  reminders: string[];
  is_high_risk: boolean;
  created_at: string;
  updated_at: string;
}

// 分类接口
export interface Category {
  id: string;
  user_id?: string | null;
  name: string;
  color: string;
  icon: string;
}

function rowToSchedule(row: any): Schedule {
  return {
    ...row,
    user_id: row.user_id || 'default',
    calendar_id: row.calendar_id || 'personal',
    all_day: row.all_day === 1,
    is_unscheduled: row.is_unscheduled === 1,
    is_completed: row.is_completed === 1,
    is_repeated: row.is_repeated === 1,
    is_high_risk: row.is_high_risk === 1,
    reminders: row.reminders ? JSON.parse(row.reminders) : [],
    type: row.type || 'event'
  };
}

// 获取所有日程
export function getAllSchedules(userId?: string): Schedule[] {
  if (userId) {
    return queryAll<any>('SELECT * FROM schedules WHERE user_id = ? ORDER BY start_time ASC', [userId]).map(rowToSchedule);
  }
  return queryAll<any>('SELECT * FROM schedules ORDER BY start_time ASC').map(rowToSchedule);
}

// 获取指定日期范围的日程
export function getSchedulesByDateRange(startDate: string, endDate: string, userId?: string): Schedule[] {
  if (userId) {
    return queryAll<any>(
      'SELECT * FROM schedules WHERE start_time >= ? AND start_time <= ? AND is_unscheduled = 0 AND user_id = ? ORDER BY start_time ASC',
      [startDate, endDate, userId]
    ).map(rowToSchedule);
  }
  return queryAll<any>(
    'SELECT * FROM schedules WHERE start_time >= ? AND start_time <= ? AND is_unscheduled = 0 ORDER BY start_time ASC',
    [startDate, endDate]
  ).map(rowToSchedule);
}

// 获取指定日期的日程
export function getSchedulesByDate(date: string, userId?: string): Schedule[] {
  if (userId) {
    return queryAll<any>(
      'SELECT * FROM schedules WHERE date(start_time) = date(?) AND is_unscheduled = 0 AND user_id = ? ORDER BY start_time ASC',
      [date, userId]
    ).map(rowToSchedule);
  }
  return queryAll<any>(
    'SELECT * FROM schedules WHERE date(start_time) = date(?) AND is_unscheduled = 0 ORDER BY start_time ASC',
    [date]
  ).map(rowToSchedule);
}

// 获取单个日程
export function getSchedule(id: string): Schedule | null {
  const row = queryOne<any>('SELECT * FROM schedules WHERE id = ?', [id]);
  if (!row) return null;
  return rowToSchedule(row);
}

// 辅助函数：安全地将值转为 null 或原值（处理字符串 "null"）
function safeNull(val: any): any {
  if (val === null || val === undefined || val === 'null' || val === '') return null;
  return val;
}

// 创建日程
export function createSchedule(schedule: Omit<Schedule, 'created_at' | 'updated_at'>): Schedule {
  const now = new Date().toISOString();
  const isUnscheduled = schedule.is_unscheduled === true;
  const startTimeValue = schedule.start_time || now;
  const calendars = schedule.user_id ? getAllCalendars(schedule.user_id) : [];
  const requestedCalendar = schedule.calendar_id || 'personal';
  const calendarId = calendars.find(item => item.id === requestedCalendar)?.id
    || calendars.find(item => item.id.endsWith(':' + requestedCalendar))?.id
    || calendars.find(item => item.is_default)?.id
    || requestedCalendar;

  // 【关键修复】全天日程的 end_time 不能为 null，设置为 start_time（同一天结束）
  const endTimeValue = isUnscheduled
    ? null
    : safeNull(schedule.end_time) || (schedule.all_day ? startTimeValue : null);

  run(
    `INSERT INTO schedules (id, user_id, calendar_id, type, title, description, start_time, end_time, all_day, is_unscheduled, location, notes, category, priority, is_completed, is_repeated, repeat_rule, reminders, is_high_risk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schedule.id,
      schedule.user_id || 'default',
      calendarId,
      schedule.type || 'event',
      schedule.title,
      safeNull(schedule.description),
      startTimeValue,
      endTimeValue,
      schedule.all_day ? 1 : 0,
      isUnscheduled ? 1 : 0,
      safeNull(schedule.location),
      safeNull(schedule.notes),
      schedule.category,
      schedule.priority,
      schedule.is_completed ? 1 : 0,
      schedule.is_repeated ? 1 : 0,
      safeNull(schedule.repeat_rule),
      JSON.stringify(schedule.reminders || []),
      schedule.is_high_risk ? 1 : 0,
      now,
      now
    ]
  );

  return getSchedule(schedule.id)!;
}

// 批量创建日程（AI 排期使用）
export function createSchedulesBatch(schedules: Omit<Schedule, 'created_at' | 'updated_at'>[]): Schedule[] {
  const results: Schedule[] = [];
  for (const s of schedules) {
    results.push(createSchedule(s));
  }
  return results;
}

// 更新日程
export function updateSchedule(id: string, updates: Partial<Schedule>): Schedule | null {
  const existing = getSchedule(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };
  const isUnscheduled = merged.is_unscheduled === true;
  const startTimeValue = merged.start_time || now;

  // 【关键修复】全天日程的 end_time 不能为 null
  const endTimeValue = isUnscheduled
    ? null
    : safeNull(merged.end_time) || (merged.all_day ? startTimeValue : null);

  run(
    `UPDATE schedules SET
      type = ?,
      title = ?,
      description = ?,
      start_time = ?,
      end_time = ?,
      all_day = ?,
      is_unscheduled = ?,
      location = ?,
      notes = ?,
      category = ?,
      priority = ?,
      is_completed = ?,
      is_repeated = ?,
      repeat_rule = ?,
      reminders = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      merged.type || 'event',
      merged.title,
      safeNull(merged.description),
      startTimeValue,
      endTimeValue,
      merged.all_day ? 1 : 0,
      isUnscheduled ? 1 : 0,
      safeNull(merged.location),
      safeNull(merged.notes),
      merged.category,
      merged.priority,
      merged.is_completed ? 1 : 0,
      merged.is_repeated ? 1 : 0,
      safeNull(merged.repeat_rule),
      JSON.stringify(merged.reminders || []),
      now,
      id
    ]
  );

  return getSchedule(id);
}

// 删除日程
export function deleteSchedule(id: string): boolean {
  const result = run('DELETE FROM schedules WHERE id = ?', [id]);
  return result.changes > 0;
}

// 标记日程完成状态
export function toggleScheduleComplete(id: string): Schedule | null {
  const schedule = getSchedule(id);
  if (!schedule) return null;
  return updateSchedule(id, { is_completed: !schedule.is_completed });
}

// 获取所有分类
export function getAllCategories(userId?: string): Category[] {
  if (!userId) return queryAll<Category>('SELECT * FROM categories WHERE user_id IS NULL ORDER BY name ASC');
  return queryAll<Category>('SELECT * FROM categories WHERE user_id IS NULL OR user_id = ? ORDER BY name ASC', [userId]);
}

// 创建分类
export function createCategory(category: Category): Category {
  run(
    'INSERT INTO categories (id, user_id, name, color, icon, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [category.id, category.user_id || null, category.name, category.color, category.icon, new Date().toISOString()]
  );
  return category;
}

// 删除分类
export function deleteCategory(id: string, userId?: string): boolean {
  if (id === 'other') return false;
  const result = userId
    ? run('DELETE FROM categories WHERE id = ? AND user_id = ?', [id, userId])
    : run('DELETE FROM categories WHERE id = ? AND user_id IS NULL', [id]);
  return result.changes > 0;
}

// ============= 日程表（Calendar）管理 =============

function rowToCalendar(row: any): Calendar {
  return {
    ...row,
    is_visible: row.is_visible === 1,
    is_default: row.is_default === 1,
  };
}

// 获取所有日程表
function ensureUserCalendars(userId: string): void {
  const existing = queryAll<any>('SELECT * FROM calendars WHERE user_id = ?', [userId]);
  if (existing.length > 0) return;
  const legacy = queryAll<any>('SELECT * FROM calendars WHERE user_id IS NULL ORDER BY is_default DESC, created_at ASC');
  const defaults = legacy.length ? legacy : [
    { id: 'personal', name: '个人', color: '#3B82F6', icon: '👤', is_visible: 1, is_default: 1 },
    { id: 'work', name: '工作', color: '#8B5CF6', icon: '💼', is_visible: 1, is_default: 0 },
    { id: 'family', name: '家庭', color: '#10B981', icon: '🏠', is_visible: 1, is_default: 0 },
  ];
  const now = new Date().toISOString();
  for (const item of defaults) {
    const id = userId + ':' + item.id;
    db.run(
      'INSERT OR IGNORE INTO calendars (id, user_id, name, color, icon, is_visible, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, userId, item.name, item.color, item.icon, item.is_visible ?? 1, item.is_default ?? 0, now],
    );
    db.run('UPDATE schedules SET calendar_id = ? WHERE user_id = ? AND calendar_id = ?', [id, userId, item.id]);
  }
  saveScheduleDb();
}

export function getAllCalendars(userId?: string): Calendar[] {
  if (!userId) return [];
  ensureUserCalendars(userId);
  return queryAll<any>('SELECT * FROM calendars WHERE user_id = ? ORDER BY is_default DESC, created_at ASC', [userId]).map(rowToCalendar);
}

// 获取单个日程表
export function getCalendar(id: string, userId?: string): Calendar | null {
  const row = userId
    ? queryOne<any>('SELECT * FROM calendars WHERE id = ? AND user_id = ?', [id, userId])
    : queryOne<any>('SELECT * FROM calendars WHERE id = ?', [id]);
  if (!row) return null;
  return rowToCalendar(row);
}

// 创建日程表
export function createCalendar(calendar: Omit<Calendar, 'created_at'>): Calendar {
  const now = new Date().toISOString();
  run(
    'INSERT INTO calendars (id, user_id, name, color, icon, is_visible, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [calendar.id, calendar.user_id || null, calendar.name, calendar.color, calendar.icon, calendar.is_visible ? 1 : 0, calendar.is_default ? 1 : 0, now]
  );
  return getCalendar(calendar.id)!;
}

// 更新日程表
export function updateCalendar(id: string, updates: Partial<Omit<Calendar, 'id' | 'created_at'>>, userId?: string): Calendar | null {
  const existing = getCalendar(id, userId);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  run(
    'UPDATE calendars SET name = ?, color = ?, icon = ?, is_visible = ?, is_default = ? WHERE id = ?',
    [merged.name, merged.color, merged.icon, merged.is_visible ? 1 : 0, merged.is_default ? 1 : 0, id]
  );
  return getCalendar(id, userId);
}

// 删除日程表（同时删除该日程表下所有日程）
export function deleteCalendar(id: string, userId?: string): boolean {
  const calendar = getCalendar(id, userId);
  if (!calendar || calendar.is_default) return false;
  if (userId) run('DELETE FROM schedules WHERE calendar_id = ? AND user_id = ?', [id, userId]);
  else run('DELETE FROM schedules WHERE calendar_id = ?', [id]);
  const result = userId
    ? run('DELETE FROM calendars WHERE id = ? AND user_id = ?', [id, userId])
    : run('DELETE FROM calendars WHERE id = ?', [id]);
  return result.changes > 0;
}

// 删除用户的所有日程
export function deleteSchedulesByUser(userId: string): number {
  const result = run('DELETE FROM schedules WHERE user_id = ?', [userId]);
  return result.changes;
}

export function exportUserScheduleData(userId: string): { schedules: Schedule[]; calendars: Calendar[]; categories: Category[] } {
  return { schedules: getAllSchedules(userId), calendars: getAllCalendars(userId), categories: getAllCategories(userId) };
}

export function exportScheduleDb(): Buffer {
  return Buffer.from(db.export());
}

export function restoreUserScheduleData(
  userId: string,
  data: { schedules?: Schedule[]; calendars?: Calendar[]; categories?: Category[] },
  mode: 'merge' | 'replace',
): { schedules: number; calendars: number; categories: number } {
  if (mode === 'replace') {
    db.run('DELETE FROM schedules WHERE user_id = ?', [userId]);
    db.run('DELETE FROM calendars WHERE user_id = ?', [userId]);
    db.run('DELETE FROM categories WHERE user_id = ?', [userId]);
  }
  let schedules = 0;
  let calendars = 0;
  let categories = 0;
  for (const calendar of data.calendars || []) {
    const id = String(calendar.id);
    if (!id || queryOne('SELECT id FROM calendars WHERE id = ?', [id])) continue;
    db.run(
      'INSERT INTO calendars (id, user_id, name, color, icon, is_visible, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, userId, String(calendar.name || '日历'), calendar.color || '#3B82F6', calendar.icon || '📅',
        calendar.is_visible ? 1 : 0, calendar.is_default ? 1 : 0, calendar.created_at || new Date().toISOString()],
    );
    calendars++;
  }
  for (const category of data.categories || []) {
    if (!category.user_id) continue;
    const id = String(category.id);
    if (!id || queryOne('SELECT id FROM categories WHERE id = ?', [id])) continue;
    db.run(
      'INSERT INTO categories (id, user_id, name, color, icon, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, String(category.name || '分类'), category.color || '#3B82F6', category.icon || '📌', category.created_at || new Date().toISOString()],
    );
    categories++;
  }
  for (const schedule of data.schedules || []) {
    const id = String(schedule.id);
    if (!id || queryOne('SELECT id FROM schedules WHERE id = ?', [id])) continue;
    db.run(
      `INSERT INTO schedules (id, user_id, calendar_id, type, title, description, start_time, end_time, all_day, is_unscheduled, location, notes, category,
       priority, is_completed, is_repeated, repeat_rule, reminders, is_high_risk, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
       [id, userId, schedule.calendar_id, schedule.type, schedule.title, schedule.description || null, schedule.start_time || new Date().toISOString(),
         schedule.is_unscheduled ? null : (schedule.end_time || null), schedule.all_day ? 1 : 0, schedule.is_unscheduled ? 1 : 0, schedule.location || null, schedule.notes || null,
        schedule.category || 'other', schedule.priority || 'medium', schedule.is_completed ? 1 : 0, schedule.is_repeated ? 1 : 0,
        schedule.repeat_rule || null, JSON.stringify(schedule.reminders || []), schedule.is_high_risk ? 1 : 0,
        schedule.created_at || new Date().toISOString(), schedule.updated_at || new Date().toISOString()],
    );
    schedules++;
  }
  saveScheduleDb();
  ensureUserCalendars(userId);
  return { schedules, calendars, categories };
}

// 导出数据库初始化函数
export { initScheduleDb };
