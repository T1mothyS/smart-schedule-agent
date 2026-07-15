import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import * as db from './db.js';
import * as scheduleStore from './schedule-store.js';
import * as reminderStore from './reminder-store.js';
import * as activityStore from './activity-store.js';
import * as attachmentService from './attachment-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAGIC = Buffer.from('AICALBK1');
const FORMAT_VERSION = 1;

interface UserBackupPayload {
  format: 'aicalendar-user';
  version: number;
  exportedAt: string;
  account: { email: string | null; reminder: unknown };
  schedule: ReturnType<typeof scheduleStore.exportUserScheduleData>;
  reminder: ReturnType<typeof reminderStore.exportUserReminderData>;
  activity: ReturnType<typeof activityStore.exportUserActivity>;
  files: Array<{
    completionId: string | null;
    importId: string | null;
    originalName: string;
    mimeType: string;
    base64: string;
  }>;
}

interface SystemBackupPayload {
  format: 'aicalendar-system';
  version: number;
  exportedAt: string;
  databases: Record<string, string>;
  files: Array<{ relativePath: string; base64: string }>;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  if (password.length < 8) throw new Error('备份密码至少需要 8 个字符');
  return crypto.scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1 });
}

export function encryptBackup(payload: unknown, password: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
}

export function decryptBackup<T>(buffer: Buffer, password: string): T {
  if (buffer.length < 52 || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('备份文件格式不正确');
  const salt = buffer.subarray(8, 24);
  const iv = buffer.subarray(24, 36);
  const tag = buffer.subarray(36, 52);
  const encrypted = buffer.subarray(52);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) as T;
  } catch {
    throw new Error('备份密码错误或文件已经损坏');
  }
}

export function createUserBackup(userId: string, password: string): Buffer {
  const accountData = db.exportUserAccountData(userId);
  const activity = activityStore.exportUserActivity(userId);
  const files = activityStore.listAttachments(userId).map(record => ({
    completionId: record.completionId,
    importId: record.importId,
    originalName: record.originalName,
    mimeType: record.mimeType,
    base64: attachmentService.readAttachment(record).toString('base64'),
  }));
  const payload: UserBackupPayload = {
    format: 'aicalendar-user',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    account: { email: accountData.user?.email || null, reminder: accountData.reminder },
    schedule: scheduleStore.exportUserScheduleData(userId),
    reminder: reminderStore.exportUserReminderData(userId),
    activity,
    files,
  };
  return encryptBackup(payload, password);
}

function validateUserPayload(payload: UserBackupPayload): void {
  if (payload?.format !== 'aicalendar-user' || payload.version !== FORMAT_VERSION) throw new Error('不支持的用户备份版本');
  if (!payload.schedule || !payload.reminder || !payload.activity || !Array.isArray(payload.files)) throw new Error('备份内容不完整');
}

export function inspectUserBackup(buffer: Buffer, password: string): Record<string, unknown> {
  const payload = decryptBackup<UserBackupPayload>(buffer, password);
  validateUserPayload(payload);
  return {
    version: payload.version,
    exportedAt: payload.exportedAt,
    sourceEmail: payload.account.email,
    counts: {
      schedules: payload.schedule.schedules?.length || 0,
      calendars: payload.schedule.calendars?.length || 0,
      reminderTasks: payload.reminder.tasks?.length || 0,
      reminderCycles: payload.reminder.cycles?.length || 0,
      completions: (payload.activity.completions || []).length,
      attachments: payload.files.length,
      notifications: (payload.activity.notifications || []).length,
      aiImports: (payload.activity.aiImports || []).length,
    },
  };
}

export function restoreUserBackup(userId: string, buffer: Buffer, password: string, mode: 'merge' | 'replace'): Record<string, unknown> {
  const payload = decryptBackup<UserBackupPayload>(buffer, password);
  validateUserPayload(payload);
  const safetyCopy = createUserBackup(userId, password);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, 'pre-user-restore-' + userId + '-' + Date.now() + '.aicalendar-backup'), safetyCopy);
  const schedule = scheduleStore.restoreUserScheduleData(userId, payload.schedule, mode);
  const reminder = reminderStore.restoreUserReminderData(userId, payload.reminder, mode);
  const activity = activityStore.restoreUserActivity(userId, payload.activity, mode);
  const preference = payload.account.reminder as any;
  if (preference) {
    const current = db.getReminder(userId);
    const restoredPreference = mode === 'replace' || !current ? preference : current;
    db.upsertReminder({
      ...restoredPreference,
      id: current?.id || preference.id,
      user_id: userId,
      reminder_email: restoredPreference.reminder_email,
      created_at: current?.created_at || preference.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  let attachments = 0;
  for (const file of payload.files) {
    try {
      attachmentService.saveBase64Attachment({
        userId,
        completionId: file.completionId,
        importId: file.importId,
        originalName: file.originalName,
        mimeType: file.mimeType,
        base64: file.base64,
      });
      attachments++;
    } catch {
      // 单个损坏附件不会使结构化数据恢复失败，结果中会体现数量差异。
    }
  }
  return { schedule, reminder, activity, attachments, mode };
}

function collectFiles(root: string): Array<{ relativePath: string; base64: string }> {
  if (!fs.existsSync(root)) return [];
  const result: Array<{ relativePath: string; base64: string }> = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else result.push({ relativePath: path.relative(root, fullPath).replace(/\\/g, '/'), base64: fs.readFileSync(fullPath).toString('base64') });
    }
  };
  walk(root);
  return result;
}

export function createSystemSnapshot(uploadToOss = true): { filename: string; path: string; size: number; ossStatus: 'disabled' | 'pending' } {
  const password = process.env.BACKUP_ENCRYPTION_KEY;
  if (!password) throw new Error('缺少 BACKUP_ENCRYPTION_KEY，无法生成系统备份');
  const payload: SystemBackupPayload = {
    format: 'aicalendar-system',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    databases: {
      'chat.db': db.exportChatDb().toString('base64'),
      'schedule.db': scheduleStore.exportScheduleDb().toString('base64'),
      'reminder.db': reminderStore.exportReminderDb().toString('base64'),
      'activity.db': activityStore.exportActivityDb().toString('base64'),
    },
    files: collectFiles(attachmentService.attachmentsRoot()),
  };
  const encrypted = encryptBackup(payload, password);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = 'system-' + new Date().toISOString().replace(/[:.]/g, '-') + '.aicalendar-backup';
  const target = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(target, encrypted);
  const local = fs.readdirSync(BACKUP_DIR)
    .filter(name => name.startsWith('system-'))
    .sort()
    .reverse();
  for (const name of local.slice(7)) {
    const marker = path.join(BACKUP_DIR, name + '.oss-uploaded');
    // OSS 不可用时保留尚未离机的快照，避免本地轮换造成唯一副本丢失。
    if (!uploadToOss || !hasOssConfig() || fs.existsSync(marker)) {
      fs.unlinkSync(path.join(BACKUP_DIR, name));
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    }
  }
  return {
    filename,
    path: target,
    size: encrypted.length,
    ossStatus: uploadToOss && hasOssConfig() ? 'pending' : 'disabled',
  };
}

function hasOssConfig(): boolean {
  return !!(process.env.OSS_BUCKET && process.env.OSS_ENDPOINT && process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET);
}

let ossUploadRunning = false;

export async function uploadPendingSystemSnapshots(): Promise<{ uploaded: number; failed: number }> {
  if (!hasOssConfig() || !fs.existsSync(BACKUP_DIR) || ossUploadRunning) return { uploaded: 0, failed: 0 };
  ossUploadRunning = true;
  let uploaded = 0;
  let failed = 0;
  try {
    const pending = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith('system-') && name.endsWith('.aicalendar-backup'))
      .filter(name => !fs.existsSync(path.join(BACKUP_DIR, name + '.oss-uploaded')))
      .sort();
    for (const filename of pending) {
      try {
        const target = path.join(BACKUP_DIR, filename);
        const data = fs.readFileSync(target);
        const stat = fs.statSync(target);
        const backupDate = stat.mtime.toISOString().slice(0, 10);
        await uploadOss(`daily/${backupDate}.aicalendar-backup`, data);
        const date = new Date(backupDate + 'T12:00:00Z');
        if (date.getUTCDate() === 1) {
          await uploadOss(`monthly/${backupDate.slice(0, 7)}.aicalendar-backup`, data);
          const oldMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 12, 1));
          await deleteOss(`monthly/${oldMonth.toISOString().slice(0, 7)}.aicalendar-backup`);
        }
        const oldDaily = new Date(date.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
        await deleteOss(`daily/${oldDaily}.aicalendar-backup`);
        fs.writeFileSync(path.join(BACKUP_DIR, filename + '.oss-uploaded'), new Date().toISOString(), 'utf8');
        uploaded++;
      } catch (error) {
        failed++;
        console.error('[Backup] OSS upload failed:', error);
      }
    }
  } finally {
    ossUploadRunning = false;
  }
  return { uploaded, failed };
}

export function listSystemSnapshots(): Array<{ filename: string; size: number; createdAt: string }> {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(name => name.endsWith('.aicalendar-backup'))
    .map(filename => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readSystemSnapshot(filename: string): Buffer {
  const safe = path.basename(filename);
  const target = path.join(BACKUP_DIR, safe);
  if (!target.startsWith(path.resolve(BACKUP_DIR) + path.sep) || !fs.existsSync(target)) throw new Error('系统备份不存在');
  return fs.readFileSync(target);
}

export function restoreSystemSnapshot(buffer: Buffer, confirmation: string): void {
  if (process.env.MAINTENANCE_MODE !== 'true') throw new Error('全站恢复只允许在 MAINTENANCE_MODE=true 时执行');
  if (confirmation !== 'RESTORE AI CALENDAR') throw new Error('恢复确认文字不正确');
  const password = process.env.BACKUP_ENCRYPTION_KEY || '';
  const payload = decryptBackup<SystemBackupPayload>(buffer, password);
  if (payload.format !== 'aicalendar-system' || payload.version !== FORMAT_VERSION) throw new Error('系统备份版本不正确');
  createSystemSnapshot(false);
  for (const [name, base64] of Object.entries(payload.databases)) {
    if (!['chat.db', 'schedule.db', 'reminder.db', 'activity.db'].includes(name)) continue;
    const target = path.join(DATA_DIR, name);
    const temp = target + '.restore';
    fs.writeFileSync(temp, Buffer.from(base64, 'base64'));
    fs.renameSync(temp, target);
  }
  const attachmentRoot = attachmentService.attachmentsRoot();
  for (const file of payload.files) {
    const target = path.resolve(attachmentRoot, file.relativePath);
    if (!target.startsWith(path.resolve(attachmentRoot) + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.base64, 'base64'));
  }
}

function uploadOss(objectKey: string, data: Buffer): Promise<void> {
  const bucket = process.env.OSS_BUCKET!;
  const endpoint = process.env.OSS_ENDPOINT!.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID!;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET!;
  const date = new Date().toUTCString();
  const contentType = 'application/octet-stream';
  const resource = '/' + bucket + '/' + objectKey;
  const stringToSign = ['PUT', '', contentType, date, resource].join('\n');
  const signature = crypto.createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64');
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: bucket + '.' + endpoint,
      path: '/' + objectKey.split('/').map(encodeURIComponent).join('/'),
      method: 'PUT',
      headers: {
        Authorization: 'OSS ' + accessKeyId + ':' + signature,
        Date: date,
        'Content-Type': contentType,
        'Content-Length': data.length,
      },
    }, response => {
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
      else reject(new Error('OSS 上传失败，HTTP ' + response.statusCode));
      response.resume();
    });
    request.on('error', reject);
    request.end(data);
  });
}

function deleteOss(objectKey: string): Promise<void> {
  const bucket = process.env.OSS_BUCKET!;
  const endpoint = process.env.OSS_ENDPOINT!.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID!;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET!;
  const date = new Date().toUTCString();
  const resource = '/' + bucket + '/' + objectKey;
  const signature = crypto.createHmac('sha1', accessKeySecret).update(['DELETE', '', '', date, resource].join('\n')).digest('base64');
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: bucket + '.' + endpoint,
      path: '/' + objectKey.split('/').map(encodeURIComponent).join('/'),
      method: 'DELETE',
      headers: { Authorization: 'OSS ' + accessKeyId + ':' + signature, Date: date },
    }, response => {
      if (response.statusCode === 404 || (response.statusCode && response.statusCode >= 200 && response.statusCode < 300)) resolve();
      else reject(new Error('OSS 清理失败，HTTP ' + response.statusCode));
      response.resume();
    });
    request.on('error', reject);
    request.end();
  });
}
