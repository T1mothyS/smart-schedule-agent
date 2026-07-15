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
const DB_PATH = path.join(__dirname, '..', 'data', 'schedule.db');

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
  try { db.run(`ALTER TABLE schedules ADD COLUMN notes TEXT`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN calendar_id TEXT DEFAULT 'personal'`); } catch {}
  try { db.run(`ALTER TABLE schedules ADD COLUMN is_high_risk INTEGER DEFAULT 0`); } catch {}

  // 创建分类表
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3B82F6',
      icon TEXT DEFAULT '📌',
      created_at TEXT NOT NULL
    )
  `);

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
      'SELECT * FROM schedules WHERE start_time >= ? AND start_time <= ? AND user_id = ? ORDER BY start_time ASC',
      [startDate, endDate, userId]
    ).map(rowToSchedule);
  }
  return queryAll<any>(
    'SELECT * FROM schedules WHERE start_time >= ? AND start_time <= ? ORDER BY start_time ASC',
    [startDate, endDate]
  ).map(rowToSchedule);
}

// 获取指定日期的日程
export function getSchedulesByDate(date: string, userId?: string): Schedule[] {
  if (userId) {
    return queryAll<any>(
      'SELECT * FROM schedules WHERE date(start_time) = date(?) AND user_id = ? ORDER BY start_time ASC',
      [date, userId]
    ).map(rowToSchedule);
  }
  return queryAll<any>(
    'SELECT * FROM schedules WHERE date(start_time) = date(?) ORDER BY start_time ASC',
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

  // 【关键修复】全天日程的 end_time 不能为 null，设置为 start_time（同一天结束）
  const endTimeValue = safeNull(schedule.end_time) || (schedule.all_day ? schedule.start_time : null);

  run(
    `INSERT INTO schedules (id, user_id, calendar_id, type, title, description, start_time, end_time, all_day, location, notes, category, priority, is_completed, is_repeated, repeat_rule, reminders, is_high_risk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schedule.id,
      schedule.user_id || 'default',
      schedule.calendar_id || 'personal',
      schedule.type || 'event',
      schedule.title,
      safeNull(schedule.description),
      schedule.start_time,
      endTimeValue,
      schedule.all_day ? 1 : 0,
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

  // 【关键修复】全天日程的 end_time 不能为 null
  const endTimeValue = safeNull(merged.end_time) || (merged.all_day ? merged.start_time : null);

  run(
    `UPDATE schedules SET
      type = ?,
      title = ?,
      description = ?,
      start_time = ?,
      end_time = ?,
      all_day = ?,
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
      merged.start_time,
      endTimeValue,
      merged.all_day ? 1 : 0,
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
export function getAllCategories(): Category[] {
  return queryAll<Category>('SELECT * FROM categories ORDER BY name ASC');
}

// 创建分类
export function createCategory(category: Category): Category {
  run(
    'INSERT INTO categories (id, name, color, icon, created_at) VALUES (?, ?, ?, ?, ?)',
    [category.id, category.name, category.color, category.icon, new Date().toISOString()]
  );
  return category;
}

// 删除分类
export function deleteCategory(id: string): boolean {
  if (id === 'other') return false;
  const result = run('DELETE FROM categories WHERE id = ?', [id]);
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
export function getAllCalendars(): Calendar[] {
  return queryAll<any>('SELECT * FROM calendars ORDER BY is_default DESC, created_at ASC').map(rowToCalendar);
}

// 获取单个日程表
export function getCalendar(id: string): Calendar | null {
  const row = queryOne<any>('SELECT * FROM calendars WHERE id = ?', [id]);
  if (!row) return null;
  return rowToCalendar(row);
}

// 创建日程表
export function createCalendar(calendar: Omit<Calendar, 'created_at'>): Calendar {
  const now = new Date().toISOString();
  run(
    'INSERT INTO calendars (id, name, color, icon, is_visible, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [calendar.id, calendar.name, calendar.color, calendar.icon, calendar.is_visible ? 1 : 0, calendar.is_default ? 1 : 0, now]
  );
  return getCalendar(calendar.id)!;
}

// 更新日程表
export function updateCalendar(id: string, updates: Partial<Omit<Calendar, 'id' | 'created_at'>>): Calendar | null {
  const existing = getCalendar(id);
  if (!existing) return null;
  const merged = { ...existing, ...updates };
  run(
    'UPDATE calendars SET name = ?, color = ?, icon = ?, is_visible = ?, is_default = ? WHERE id = ?',
    [merged.name, merged.color, merged.icon, merged.is_visible ? 1 : 0, merged.is_default ? 1 : 0, id]
  );
  return getCalendar(id);
}

// 删除日程表（同时删除该日程表下所有日程）
export function deleteCalendar(id: string): boolean {
  if (id === 'personal') return false;
  run('DELETE FROM schedules WHERE calendar_id = ?', [id]);
  const result = run('DELETE FROM calendars WHERE id = ?', [id]);
  return result.changes > 0;
}

// 删除用户的所有日程
export function deleteSchedulesByUser(userId: string): number {
  const result = run('DELETE FROM schedules WHERE user_id = ?', [userId]);
  return result.changes;
}

// 导出数据库初始化函数
export { initScheduleDb };
