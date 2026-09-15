import { applyChatSchema } from './schema.js';
import { registerPersistence, persistDatabase, recoverPersistence, assertPersistenceReady } from '../persistence.js';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径；测试可通过 DATA_DIR 使用隔离目录。
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '../..', 'data');
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
export async function initDb(): Promise<void> {
  assertNoUnreconciledChatWal();
  recoverPersistence(dataDir);
  const SQL = await initSqlJs();

  // 尝试加载已有数据库
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  registerPersistence(dbPath, () => db.export(), bytes => {
    db.close();
    db = new SQL.Database(bytes);
  });

  applyChatSchema(db, { queryAll, queryOne });

  // 保存到文件
  saveDb();

  console.log('[DB] Database initialized with sql.js');
}

// 保存数据库到文件
export function saveDb(): void {
  persistDatabase(dbPath);
}

// 辅助函数：将结果转为对象数组
export function queryAll<T>(sql: string, params: any[] = []): T[] {
  assertPersistenceReady();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export function queryOne<T>(sql: string, params: any[] = []): T | undefined {
  const results = queryAll<T>(sql, params);
  return results[0];
}

export function run(sql: string, params: any[] = []): { changes: number } {
  // 将所有 undefined 转为 null（sql.js 不允许 undefined）
  const safeParams = params.map(p => p === undefined ? null : p);
  db.run(sql, safeParams);
  const changes = db.getRowsModified();
  saveDb();
  return { changes };
}

export function executeWithoutSave(sql: string, params: any[] = []): void {
  const safeParams = params.map(p => p === undefined ? null : p);
  db.run(sql, safeParams);
}

export function runTransaction<T>(callback: () => T): T {
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


export function exportChatDb(): Buffer {
  assertPersistenceReady();
  return Buffer.from(db.export());
}
