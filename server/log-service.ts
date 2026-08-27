import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogCategory = 'schedule' | 'ai' | 'db' | 'system' | 'reminder' | 'auth' | 'admin';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: unknown;
}

export const MAX_LOG_ENTRIES = 2_000;
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LOG_BACKUPS = 3;
const MAX_DATA_DEPTH = 5;
const MAX_STRING_LENGTH = 4_000;

let loaded = false;
const logBuffer: LogEntry[] = [];

function getDataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
}

function getLogPath(): string {
  return path.join(getDataDir(), 'application.log');
}

function getRotatedLogPath(index: number): string {
  return path.join(getDataDir(), `application.${index}.log`);
}

function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '[email]';
  return `${value.slice(0, 1)}***@${value.slice(at + 1)}`;
}

function sanitizeString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, match => maskEmail(match))
    .replace(/\bBearer\s+[^\s]+/ig, 'Bearer [redacted]')
    .replace(/((?:password|passwd|pass|token|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/ig, '$1[redacted]')
    .slice(0, MAX_STRING_LENGTH);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();
  if (/(?:configured|valid|matches|enabled|count)$/.test(normalized)) return false;
  return /(?:^|_)(?:password|passwd|pass|token|secret|api_key|authorization|cookie)(?:_|$)/.test(normalized);
}

function sanitizeValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveKey(key)) return '[redacted]';
  if (depth > MAX_DATA_DEPTH) return '[truncated]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      ...(value.stack ? { stack: sanitizeString(value.stack) } : {}),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, '', depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      output[childKey] = sanitizeValue(childValue, childKey, depth + 1);
    }
    return output;
  }
  return sanitizeString(String(value));
}

function isLogEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LogEntry>;
  return typeof entry.timestamp === 'string'
    && ['info', 'warn', 'error', 'debug'].includes(String(entry.level))
    && ['schedule', 'ai', 'db', 'system', 'reminder', 'auth', 'admin'].includes(String(entry.category))
    && typeof entry.message === 'string';
}

function readLogFile(filePath: string): LogEntry[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isLogEntry(parsed) ? parsed : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is LogEntry => entry !== null);
  } catch (error) {
    console.error('[Log] 读取持久化日志失败:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const files = [
    ...Array.from({ length: MAX_LOG_BACKUPS }, (_, index) => getRotatedLogPath(MAX_LOG_BACKUPS - index)),
    getLogPath(),
  ];
  for (const filePath of files) {
    logBuffer.push(...readLogFile(filePath));
    if (logBuffer.length > MAX_LOG_ENTRIES * 2) logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
  }
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
}

function removeIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch (error) {
    console.error('[Log] 清理旧日志文件失败:', error instanceof Error ? error.message : String(error));
  }
}

function rotateLogsIfNeeded(nextLineBytes: number): void {
  const logPath = getLogPath();
  let currentBytes = 0;
  try {
    currentBytes = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  } catch {
    currentBytes = 0;
  }
  if (currentBytes + nextLineBytes <= MAX_LOG_FILE_BYTES) return;

  for (let index = MAX_LOG_BACKUPS; index >= 2; index -= 1) {
    const source = getRotatedLogPath(index - 1);
    const target = getRotatedLogPath(index);
    removeIfExists(target);
    if (fs.existsSync(source)) {
      try { fs.renameSync(source, target); } catch (error) {
        console.error('[Log] 日志轮转失败:', error instanceof Error ? error.message : String(error));
      }
    }
  }
  const firstBackup = getRotatedLogPath(1);
  removeIfExists(firstBackup);
  if (fs.existsSync(logPath)) {
    try { fs.renameSync(logPath, firstBackup); } catch (error) {
      console.error('[Log] 日志轮转失败:', error instanceof Error ? error.message : String(error));
    }
  }
}

function appendPersistent(entry: LogEntry): void {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    const line = `${JSON.stringify(entry)}\n`;
    rotateLogsIfNeeded(Buffer.byteLength(line, 'utf8'));
    fs.appendFileSync(getLogPath(), line, 'utf8');
  } catch (error) {
    // 日志写入故障不应导致主服务退出；控制台仍保留当前错误。
    console.error('[Log] 写入持久化日志失败:', error instanceof Error ? error.message : String(error));
  }
}

function timestampNow(date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function addLog(level: LogLevel, category: LogCategory, message: string, data?: unknown): LogEntry {
  ensureLoaded();
  const entry: LogEntry = {
    timestamp: timestampNow(),
    level,
    category,
    message: sanitizeString(message),
    ...(data === undefined ? {} : { data: sanitizeValue(data) }),
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
  appendPersistent(entry);

  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${category}]`;
  if (level === 'error') console.error(prefix, entry.message, entry.data ?? '');
  else if (level === 'warn') console.warn(prefix, entry.message, entry.data ?? '');
  else console.log(prefix, entry.message, entry.data ?? '');
  return entry;
}

export function listLogs(options: { level?: string; category?: string; limit?: number } = {}): {
  logs: LogEntry[];
  total: number;
  max: number;
} {
  ensureLoaded();
  let filtered = [...logBuffer];
  if (options.level && options.level !== 'all') filtered = filtered.filter(entry => entry.level === options.level);
  if (options.category && options.category !== 'all') filtered = filtered.filter(entry => entry.category === options.category);
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_LOG_ENTRIES)
    : 100;
  return { logs: filtered.slice(-limit), total: logBuffer.length, max: MAX_LOG_ENTRIES };
}

export function allLogs(): LogEntry[] {
  ensureLoaded();
  return [...logBuffer];
}

export function clearLogs(): void {
  ensureLoaded();
  logBuffer.length = 0;
  removeIfExists(getLogPath());
  for (let index = 1; index <= MAX_LOG_BACKUPS; index += 1) removeIfExists(getRotatedLogPath(index));
}
