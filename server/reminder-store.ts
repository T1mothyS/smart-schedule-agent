import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'reminder.db');

export type ReminderTaskType = 'credit_card' | 'sim' | 'generic';
export type ReminderCycleStatus = 'pending' | 'completed' | 'expired' | 'cancelled';

export interface CreditCardConfig {
  statementDay: number;
  paymentDay: number;
  paymentMonthOffset: 0 | 1;
  reminderOffsets: number[];
}

export interface SimConfig {
  provider: string;
  numberMasked: string;
  region: string;
  intervalDays: number;
  lastOperationDate: string;
  actionGuide: string;
  reminderOffsets: number[];
}

export type RecurrenceRule =
  | { frequency: 'once'; anchorDate: string; advancePolicy: 'calendar' }
  | { frequency: 'monthly'; anchorDate: string; dayOfMonth: number; interval: number; advancePolicy: 'calendar' | 'completion' }
  | { frequency: 'yearly'; anchorDate: string; month: number; dayOfMonth: number; interval: number; advancePolicy: 'calendar' | 'completion' }
  | { frequency: 'interval'; anchorDate: string; unit: 'day' | 'month' | 'year'; interval: number; advancePolicy: 'calendar' | 'completion' };

export interface GenericReminderConfig {
  templateKey: 'subscription' | 'insurance' | 'document' | 'membership' | 'rent' | 'utilities' | 'vehicle_inspection' | 'custom';
  rule: RecurrenceRule;
  reminderOffsets: number[];
  reminderTime: string;
  actionGuide: string;
  priority: 'high' | 'medium' | 'low';
  amountCents?: number | null;
  currency?: string;
}

export type ReminderConfig = CreditCardConfig | SimConfig | GenericReminderConfig;

export interface ReminderTask {
  id: string;
  userId: string;
  type: ReminderTaskType;
  name: string;
  enabled: boolean;
  timezone: string;
  config: ReminderConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderCycle {
  id: string;
  taskId: string;
  cycleKey: string;
  periodStart: string;
  dueDate: string;
  status: ReminderCycleStatus;
  completedAt: string | null;
  completedNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderDelivery {
  id: string;
  cycleId: string;
  taskId: string;
  reminderType: string;
  scheduledDate: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  nextRetryAt: string | null;
}

export interface ReminderTaskSummary extends ReminderTask {
  currentCycle: ReminderCycle | null;
  nextReminderDate: string | null;
  sentReminderTypes: string[];
}

export interface DueReminder extends ReminderDelivery {
  task: ReminderTask;
  cycle: ReminderCycle;
}

let db: SqlJsDatabase;

function nowIso(): string {
  return new Date().toISOString();
}

function dateFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return dateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(date: string, days: number): string {
  const result = parseDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return formatDate(result);
}

function addMonths(date: string, months: number): string {
  const source = parseDate(date);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + months;
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(year, month + 1, 0));
  const lastDay = target.getUTCDate();
  return dateFromParts(
    Math.floor(target.getUTCFullYear()),
    target.getUTCMonth() + 1,
    Math.min(day, lastDay),
  );
}

function advanceDate(date: string, unit: 'day' | 'month' | 'year', amount: number): string {
  if (unit === 'day') return addDays(date, amount);
  return addMonths(date, unit === 'year' ? amount * 12 : amount);
}

function monthDate(year: number, monthIndex: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return dateFromParts(year, monthIndex + 1, Math.min(Math.max(day, 1), lastDay));
}

export function clampDateForMonth(year: number, month: number, day: number): string {
  return monthDate(year, month - 1, day);
}

export function todayInTimezone(timezone = process.env.APP_TIMEZONE || 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return dateFromParts(Number(values.year), Number(values.month), Number(values.day));
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

function persist(): void {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function run(sql: string, params: unknown[] = []): number {
  db.run(sql, params.map(value => value === undefined ? null : value));
  const changes = db.getRowsModified();
  persist();
  return changes;
}

function rowToTask(row: any): ReminderTask {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    name: row.name,
    enabled: row.enabled === 1,
    timezone: row.timezone || 'Asia/Shanghai',
    config: JSON.parse(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCycle(row: any): ReminderCycle {
  return {
    id: row.id,
    taskId: row.task_id,
    cycleKey: row.cycle_key,
    periodStart: row.period_start,
    dueDate: row.due_date,
    status: row.status,
    completedAt: row.completed_at,
    completedNote: row.completed_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDelivery(row: any): ReminderDelivery {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    taskId: row.task_id,
    reminderType: row.reminder_type,
    scheduledDate: row.scheduled_date,
    status: row.status,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error,
    sentAt: row.sent_at,
    nextRetryAt: row.next_retry_at,
  };
}

export async function initReminderDb(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();

  const taskSql = queryOne<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reminder_tasks'");
  if (taskSql?.sql && !taskSql.sql.includes("'generic'")) {
    const backupDir = path.join(DATA_DIR, 'migration-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(DB_PATH, path.join(backupDir, 'reminder-generic-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db'));
    db.run(`
      CREATE TABLE reminder_tasks_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        config TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO reminder_tasks_v2 SELECT id, user_id, type, name, enabled, timezone, config, created_at, updated_at FROM reminder_tasks;
      DROP TABLE reminder_tasks;
      ALTER TABLE reminder_tasks_v2 RENAME TO reminder_tasks;
    `);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS reminder_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminder_cycles (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      cycle_key TEXT NOT NULL,
      period_start TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT,
      completed_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, cycle_key)
    );
    CREATE TABLE IF NOT EXISTS reminder_deliveries (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      reminder_type TEXT NOT NULL,
      scheduled_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      sent_at TEXT,
      next_retry_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(cycle_id, reminder_type, scheduled_date)
    );
    CREATE TABLE IF NOT EXISTS reminder_audit_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      cycle_id TEXT,
      action TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminder_tasks_user ON reminder_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_reminder_cycles_task ON reminder_cycles(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_due ON reminder_deliveries(status, scheduled_date);
  `);

  // 服务中断时，上一进程可能停留在 sending，启动后允许它重试。
  db.run(`UPDATE reminder_deliveries SET status = 'failed', next_retry_at = ? WHERE status = 'sending'`, [nowIso()]);
  persist();
}

function getTaskInternal(id: string): ReminderTask | null {
  const row = queryOne<any>('SELECT * FROM reminder_tasks WHERE id = ?', [id]);
  return row ? rowToTask(row) : null;
}

function getCycleInternal(id: string): ReminderCycle | null {
  const row = queryOne<any>('SELECT * FROM reminder_cycles WHERE id = ?', [id]);
  return row ? rowToCycle(row) : null;
}

function createDelivery(task: ReminderTask, cycle: ReminderCycle, reminderType: string, scheduledDate: string): void {
  run(
    `INSERT OR IGNORE INTO reminder_deliveries
      (id, cycle_id, task_id, reminder_type, scheduled_date, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [uuidv4(), cycle.id, task.id, reminderType, scheduledDate, nowIso(), nowIso()],
  );
}

function cycleReminderDates(task: ReminderTask, cycle: ReminderCycle): Array<{ type: string; date: string }> {
  const config = task.config;
  if (task.type === 'sim') {
    const sim = config as SimConfig;
    return sim.reminderOffsets.map(offset => ({
      type: `due_minus_${offset}`,
      date: addDays(cycle.dueDate, -offset),
    }));
  }

  if (task.type === 'generic') {
    const generic = config as GenericReminderConfig;
    return generic.reminderOffsets.map(offset => ({ type: `due_minus_${offset}`, date: addDays(cycle.dueDate, -offset) }));
  }

  const card = config as CreditCardConfig;
  const statementReminder = addDays(cycle.periodStart, 1);
  const paymentReminders = card.reminderOffsets.map(offset => ({
    type: `payment_minus_${offset}`,
    date: addDays(cycle.dueDate, -offset),
  }));
  return [{ type: 'statement_issued', date: statementReminder }, ...paymentReminders];
}

function genericInitialCycle(config: GenericReminderConfig, today: string): { key: string; start: string; due: string } {
  const rule = config.rule;
  if (rule.frequency === 'once' || rule.frequency === 'interval') {
    return { key: rule.anchorDate, start: rule.anchorDate, due: rule.anchorDate };
  }
  const [year, month] = today.split('-').map(Number);
  if (rule.frequency === 'monthly') {
    const due = monthDate(year, month - 1, rule.dayOfMonth);
    return { key: due.slice(0, 7), start: due, due };
  }
  const due = monthDate(year, rule.month - 1, rule.dayOfMonth);
  return { key: String(year), start: due, due };
}

function nextGenericCycle(config: GenericReminderConfig, cycle: ReminderCycle, completedDate: string): { key: string; start: string; due: string } | null {
  const rule = config.rule;
  if (rule.frequency === 'once') return null;
  const base = rule.advancePolicy === 'completion' ? completedDate : cycle.dueDate;
  let due: string;
  if (rule.frequency === 'monthly') due = addMonths(base, rule.interval);
  else if (rule.frequency === 'yearly') due = addMonths(base, rule.interval * 12);
  else due = advanceDate(base, rule.unit, rule.interval);
  return { key: due, start: base, due };
}

function createCycle(task: ReminderTask, cycleKey: string, periodStart: string, dueDate: string): ReminderCycle {
  const existing = queryOne<any>('SELECT * FROM reminder_cycles WHERE task_id = ? AND cycle_key = ?', [task.id, cycleKey]);
  if (existing) return rowToCycle(existing);

  const now = nowIso();
  const status: ReminderCycleStatus = dueDate < todayInTimezone(task.timezone) ? 'expired' : 'pending';
  const cycle: ReminderCycle = {
    id: uuidv4(),
    taskId: task.id,
    cycleKey,
    periodStart,
    dueDate,
    status,
    completedAt: null,
    completedNote: null,
    createdAt: now,
    updatedAt: now,
  };

  run(
    `INSERT INTO reminder_cycles
      (id, task_id, cycle_key, period_start, due_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [cycle.id, task.id, cycle.cycleKey, cycle.periodStart, cycle.dueDate, cycle.status, now, now],
  );
  for (const item of cycleReminderDates(task, cycle)) createDelivery(task, cycle, item.type, item.date);
  return cycle;
}

function ensureCurrentCycle(task: ReminderTask, today = todayInTimezone(task.timezone)): ReminderCycle {
  const latest = queryOne<any>(
    `SELECT * FROM reminder_cycles WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
    [task.id],
  );
  if (latest) {
    const cycle = rowToCycle(latest);
    if (cycle.status === 'pending' && cycle.dueDate < today) {
      run('UPDATE reminder_cycles SET status = \'expired\', updated_at = ? WHERE id = ?', [nowIso(), cycle.id]);
      cycle.status = 'expired';
    }
    return cycle;
  }

  if (task.type === 'sim') {
    const sim = task.config as SimConfig;
    const dueDate = addDays(sim.lastOperationDate, sim.intervalDays);
    return createCycle(task, `${sim.lastOperationDate}:${dueDate}`, sim.lastOperationDate, dueDate);
  }


  if (task.type === 'generic') {
    const generic = task.config as GenericReminderConfig;
    const next = genericInitialCycle(generic, today);
    return createCycle(task, next.key, next.start, next.due);
  }

  const card = task.config as CreditCardConfig;
  const [year, month] = today.split('-').map(Number);
  const periodStart = monthDate(year, month - 1, card.statementDay);
  const dueMonth = month - 1 + card.paymentMonthOffset;
  const dueDate = monthDate(year + Math.floor(dueMonth / 12), dueMonth % 12, card.paymentDay);
  return createCycle(task, `${year}-${String(month).padStart(2, '0')}`, periodStart, dueDate);
}

export function listReminderTasks(userId: string): ReminderTaskSummary[] {
  const rows = queryAll<any>('SELECT * FROM reminder_tasks WHERE user_id = ? ORDER BY enabled DESC, name ASC', [userId]);
  return rows.map(row => {
    const task = rowToTask(row);
    const cycle = ensureCurrentCycle(task);
    const deliveries = queryAll<any>(
      `SELECT * FROM reminder_deliveries WHERE cycle_id = ? AND status = 'sent' ORDER BY scheduled_date ASC`,
      [cycle.id],
    ).map(rowToDelivery);
    const next = queryOne<any>(
      `SELECT scheduled_date FROM reminder_deliveries
       WHERE cycle_id = ? AND status IN ('pending', 'failed') AND scheduled_date >= ?
       ORDER BY scheduled_date ASC LIMIT 1`,
      [cycle.id, todayInTimezone(task.timezone)],
    );
    return {
      ...task,
      currentCycle: cycle,
      nextReminderDate: next?.scheduled_date || null,
      sentReminderTypes: deliveries.map(item => item.reminderType),
    };
  });
}

export function getReminderTask(id: string, userId: string): ReminderTaskSummary | null {
  const task = getTaskInternal(id);
  if (!task || task.userId !== userId) return null;
  return listReminderTasks(userId).find(item => item.id === id) || null;
}

export function createReminderTask(input: {
  userId: string;
  type: ReminderTaskType;
  name: string;
  timezone?: string;
  config: ReminderConfig;
}): ReminderTaskSummary {
  const now = nowIso();
  const task: ReminderTask = {
    id: uuidv4(),
    userId: input.userId,
    type: input.type,
    name: input.name.trim(),
    enabled: true,
    timezone: input.timezone || 'Asia/Shanghai',
    config: input.config,
    createdAt: now,
    updatedAt: now,
  };
  if (!task.name) throw new Error('任务名称不能为空');
  run(
    `INSERT INTO reminder_tasks (id, user_id, type, name, enabled, timezone, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [task.id, task.userId, task.type, task.name, task.timezone, JSON.stringify(task.config), now, now],
  );
  return getReminderTask(task.id, task.userId)!;
}

export function updateReminderTask(
  id: string,
  userId: string,
  updates: Partial<Pick<ReminderTask, 'name' | 'enabled' | 'timezone' | 'config'>>,
): ReminderTaskSummary | null {
  const task = getTaskInternal(id);
  if (!task || task.userId !== userId) return null;
  const next = {
    ...task,
    ...updates,
    name: updates.name?.trim() || task.name,
    updatedAt: nowIso(),
  };
  run(
    `UPDATE reminder_tasks SET name = ?, enabled = ?, timezone = ?, config = ?, updated_at = ? WHERE id = ?`,
    [next.name, next.enabled ? 1 : 0, next.timezone, JSON.stringify(next.config), next.updatedAt, id],
  );
  return getReminderTask(id, userId);
}

export function deleteReminderTask(id: string, userId: string): boolean {
  const task = getTaskInternal(id);
  if (!task || task.userId !== userId) return false;
  run('DELETE FROM reminder_deliveries WHERE task_id = ?', [id]);
  run('DELETE FROM reminder_audit_logs WHERE task_id = ?', [id]);
  run('DELETE FROM reminder_cycles WHERE task_id = ?', [id]);
  return run('DELETE FROM reminder_tasks WHERE id = ?', [id]) > 0;
}

export function deleteReminderTasksByUser(userId: string): number {
  const ids = queryAll<{ id: string }>('SELECT id FROM reminder_tasks WHERE user_id = ?', [userId]);
  for (const item of ids) deleteReminderTask(item.id, userId);
  return ids.length;
}

export function completeReminderCycle(
  taskId: string,
  userId: string,
  cycleId: string,
  completedDate: string,
  note?: string,
): ReminderTaskSummary | null {
  const task = getTaskInternal(taskId);
  const cycle = getCycleInternal(cycleId);
  if (!task || task.userId !== userId || !cycle || cycle.taskId !== taskId) return null;
  if (cycle.status !== 'completed') {
    const completedAt = new Date(`${completedDate}T12:00:00+08:00`).toISOString();
    run(
      `UPDATE reminder_cycles SET status = 'completed', completed_at = ?, completed_note = ?, updated_at = ? WHERE id = ?`,
      [completedAt, note?.trim() || null, nowIso(), cycle.id],
    );
    run(
      `INSERT INTO reminder_audit_logs (id, task_id, cycle_id, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), task.id, cycle.id, 'completed', note?.trim() || null, nowIso()],
    );

    if (task.type === 'sim') {
      const sim = task.config as SimConfig;
      const dueDate = addDays(completedDate, sim.intervalDays);
      createCycle(task, `${completedDate}:${dueDate}`, completedDate, dueDate);
    } else if (task.type === 'generic') {
      const next = nextGenericCycle(task.config as GenericReminderConfig, cycle, completedDate);
      if (next) createCycle(task, next.key, next.start, next.due);
    } else {
      const card = task.config as CreditCardConfig;
      const nextPeriodStart = addMonths(cycle.periodStart, 1);
      const nextDate = parseDate(nextPeriodStart);
      const dueMonth = nextDate.getUTCMonth() + card.paymentMonthOffset;
      const dueDate = monthDate(nextDate.getUTCFullYear() + Math.floor(dueMonth / 12), dueMonth % 12, card.paymentDay);
      createCycle(task, `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`, nextPeriodStart, dueDate);
    }
  }
  return getReminderTask(taskId, userId);
}

export function reopenReminderCycle(taskId: string, userId: string, cycleId: string): ReminderTaskSummary | null {
  const task = getTaskInternal(taskId);
  const cycle = getCycleInternal(cycleId);
  if (!task || task.userId !== userId || !cycle || cycle.taskId !== taskId) return null;
  const status: ReminderCycleStatus = cycle.dueDate < todayInTimezone(task.timezone) ? 'expired' : 'pending';
  run(
    `UPDATE reminder_cycles SET status = ?, completed_at = NULL, completed_note = NULL, updated_at = ? WHERE id = ?`,
    [status, nowIso(), cycleId],
  );
  run(
    `INSERT INTO reminder_audit_logs (id, task_id, cycle_id, action, note, created_at) VALUES (?, ?, ?, 'reopened', NULL, ?)`,
    [uuidv4(), taskId, cycleId, nowIso()],
  );
  return getReminderTask(taskId, userId);
}

export function getReminderHistory(taskId: string, userId: string): ReminderCycle[] {
  const task = getTaskInternal(taskId);
  if (!task || task.userId !== userId) return [];
  return queryAll<any>('SELECT * FROM reminder_cycles WHERE task_id = ? ORDER BY period_start DESC', [taskId]).map(rowToCycle);
}

export function getDueReminders(): DueReminder[] {
  const tasks = queryAll<any>(`SELECT * FROM reminder_tasks WHERE enabled = 1`).map(rowToTask);
  const result: DueReminder[] = [];
  const now = new Date();
  for (const task of tasks) {
    const today = todayInTimezone(task.timezone);
    const cycle = ensureCurrentCycle(task, today);
    if (cycle.status === 'pending' && cycle.dueDate < today) {
      run('UPDATE reminder_cycles SET status = \'expired\', updated_at = ? WHERE id = ?', [nowIso(), cycle.id]);
      continue;
    }
    if (cycle.status !== 'pending') continue;
    const rows = queryAll<any>(
      `SELECT * FROM reminder_deliveries
       WHERE cycle_id = ? AND scheduled_date BETWEEN ? AND ?
       AND status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= ?)
       AND attempts < 3 ORDER BY scheduled_date ASC`,
      [cycle.id, addDays(today, -2), today, now.toISOString()],
    );
    for (const row of rows) result.push({ ...rowToDelivery(row), task, cycle });
  }
  return result;
}

export function claimDelivery(id: string): boolean {
  const changed = run(
    `UPDATE reminder_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'failed') AND attempts < 3`,
    [nowIso(), id],
  );
  return changed > 0;
}

export function markDeliverySent(id: string): void {
  run(`UPDATE reminder_deliveries SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), id]);
}

export function markDeliveryFailed(id: string, error: string): void {
  const retryAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  run(
    `UPDATE reminder_deliveries SET status = 'failed', last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
    [error.slice(0, 500), retryAt, nowIso(), id],
  );
}

export function getReminderStats(userId: string): { total: number; active: number; dueSoon: number; expired: number } {
  const items = listReminderTasks(userId);
  const today = todayInTimezone();
  const soon = addDays(today, 7);
  return {
    total: items.length,
    active: items.filter(item => item.enabled && item.currentCycle?.status === 'pending').length,
    dueSoon: items.filter(item => item.enabled && !!item.currentCycle && item.currentCycle.dueDate >= today && item.currentCycle.dueDate <= soon).length,
    expired: items.filter(item => item.currentCycle?.status === 'expired').length,
  };
}

export function exportUserReminderData(userId: string): { tasks: ReminderTask[]; cycles: ReminderCycle[] } {
  const tasks = queryAll<any>('SELECT * FROM reminder_tasks WHERE user_id = ?', [userId]).map(rowToTask);
  const taskIds = new Set(tasks.map(task => task.id));
  const cycles = queryAll<any>('SELECT * FROM reminder_cycles ORDER BY created_at').map(rowToCycle).filter(cycle => taskIds.has(cycle.taskId));
  return { tasks, cycles };
}

export function exportReminderDb(): Buffer {
  return Buffer.from(db.export());
}

export function restoreUserReminderData(
  userId: string,
  data: { tasks?: ReminderTask[]; cycles?: ReminderCycle[] },
  mode: 'merge' | 'replace',
): { tasks: number; cycles: number } {
  if (mode === 'replace') deleteReminderTasksByUser(userId);
  const acceptedTaskIds = new Set<string>();
  let tasks = 0;
  let cycles = 0;
  for (const task of data.tasks || []) {
    const id = String(task.id);
    if (!id) continue;
    const existing = getTaskInternal(id);
    if (existing) {
      if (existing.userId === userId) acceptedTaskIds.add(id);
      continue;
    }
    db.run(
      `INSERT INTO reminder_tasks (id, user_id, type, name, enabled, timezone, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, task.type, task.name, task.enabled ? 1 : 0, task.timezone || 'Asia/Shanghai',
        JSON.stringify(task.config), task.createdAt || nowIso(), task.updatedAt || nowIso()],
    );
    acceptedTaskIds.add(id);
    tasks++;
  }
  for (const cycle of data.cycles || []) {
    if (!acceptedTaskIds.has(cycle.taskId) || queryOne('SELECT id FROM reminder_cycles WHERE id = ?', [cycle.id])) continue;
    db.run(
      `INSERT INTO reminder_cycles (id, task_id, cycle_key, period_start, due_date, status, completed_at, completed_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cycle.id, cycle.taskId, cycle.cycleKey, cycle.periodStart, cycle.dueDate, cycle.status, cycle.completedAt,
        cycle.completedNote, cycle.createdAt || nowIso(), cycle.updatedAt || nowIso()],
    );
    cycles++;
  }
  persist();
  for (const taskId of acceptedTaskIds) {
    const task = getTaskInternal(taskId);
    if (task) {
      const current = ensureCurrentCycle(task);
      for (const item of cycleReminderDates(task, current)) createDelivery(task, current, item.type, item.date);
    }
  }
  return { tasks, cycles };
}
