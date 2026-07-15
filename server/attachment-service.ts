import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as activityStore from './activity-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const ROOT = path.join(DATA_DIR, 'attachments');
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_USER_BYTES = Number(process.env.ATTACHMENT_USER_QUOTA_BYTES || 500 * 1024 * 1024);
const MAX_PER_COMPLETION = 5;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function safeName(name: string): string {
  return path.basename(name).replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').slice(0, 180) || 'attachment';
}

function detectMime(buffer: Buffer): string | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

export function saveBase64Attachment(input: {
  userId: string;
  completionId?: string | null;
  importId?: string | null;
  originalName: string;
  mimeType: string;
  base64: string;
}): activityStore.AttachmentRecord {
  if (!ALLOWED_MIME.has(input.mimeType)) throw new Error('只支持 JPEG、PNG、WebP 和 PDF 文件');
  const cleanBase64 = input.base64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_SIZE) throw new Error('附件大小必须在 1 字节到 10MB 之间');
  const detected = detectMime(buffer);
  if (!detected || detected !== input.mimeType) throw new Error('附件内容与文件类型不一致');
  if (activityStore.getUserAttachmentBytes(input.userId) + buffer.length > MAX_USER_BYTES) throw new Error('附件空间已达到用户配额');
  if (input.completionId && activityStore.listAttachments(input.userId, input.completionId).length >= MAX_PER_COMPLETION) {
    throw new Error('每次完成最多上传 5 个附件');
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const userDir = path.join(ROOT, input.userId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  fs.mkdirSync(userDir, { recursive: true });
  const extension = detected === 'application/pdf' ? '.pdf' : detected === 'image/png' ? '.png' : detected === 'image/webp' ? '.webp' : '.jpg';
  const absolutePath = path.join(userDir, sha256 + extension);
  if (!absolutePath.startsWith(path.resolve(userDir) + path.sep)) throw new Error('附件路径不安全');
  if (!fs.existsSync(absolutePath)) fs.writeFileSync(absolutePath, buffer, { flag: 'wx' });
  const storagePath = path.relative(DATA_DIR, absolutePath).replace(/\\/g, '/');
  return activityStore.addAttachment({
    userId: input.userId,
    completionId: input.completionId || null,
    importId: input.importId || null,
    originalName: safeName(input.originalName),
    mimeType: detected,
    sizeBytes: buffer.length,
    sha256,
    storagePath,
  });
}

export function readAttachment(record: activityStore.AttachmentRecord): Buffer {
  const root = path.resolve(DATA_DIR);
  const absolutePath = path.resolve(root, record.storagePath);
  if (!absolutePath.startsWith(root + path.sep)) throw new Error('附件路径不安全');
  return fs.readFileSync(absolutePath);
}

export function deleteAttachmentFileIfUnused(record: activityStore.AttachmentRecord): void {
  const remaining = activityStore.listAttachments(record.userId).some(item => item.sha256 === record.sha256);
  if (remaining) return;
  const root = path.resolve(DATA_DIR);
  const absolutePath = path.resolve(root, record.storagePath);
  if (absolutePath.startsWith(root + path.sep) && fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
}

export function attachmentsRoot(): string {
  fs.mkdirSync(ROOT, { recursive: true });
  return ROOT;
}
