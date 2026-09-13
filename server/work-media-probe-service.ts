import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DAILY_REPORT_MEDIA_MAX_BYTES,
  DAILY_REPORT_MEDIA_MAX_COUNT,
  storeProvidedDailyReportMedia,
  validateDailyReportMediaBuffer,
  type StoredMedia,
} from './daily-report-media-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const ROOT = path.join(DATA_DIR, 'work-media-probe');
const PROBE_ID_PATTERN = /^[0-9a-f-]{36}$/;
const ASSET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOKEN_HASH_HEX_LENGTH = 64;

export const WORK_MEDIA_PROBE_ROUTE = '/api/internal/work-media-probe';
export const WORK_MEDIA_PROBE_MAX_BYTES = DAILY_REPORT_MEDIA_MAX_BYTES;
export const WORK_MEDIA_PROBE_MAX_FILES = DAILY_REPORT_MEDIA_MAX_COUNT;
// Probe-only aggregate cap: three files at the current 5 MiB per-file limit.
export const WORK_MEDIA_PROBE_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
export const WORK_MEDIA_PROBE_TTL_MS = 15 * 60 * 1000;

export class WorkMediaProbeError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'WORK_MEDIA_PROBE_ERROR',
  ) {
    super(message);
    this.name = 'WorkMediaProbeError';
  }
}

export interface WorkMediaProbeTicket {
  probeId: string;
  runId: string;
  date: string | null;
  createdAt: string;
  expiresAt: string;
  uploadToken: string;
  transport: 'raw-http-put';
  maxBytesPerFile: number;
  maxFiles: number;
  maxTotalBytes: number;
}

export interface WorkMediaProbeAssetSummary {
  assetKey: string;
  originalFilename: string;
  declaredMime: string;
  detectedMime: string | null;
  bytes: number;
  sha256: string;
  receivedAt: string;
  assetId: string;
  completeRead: boolean;
  integrity: 'VERIFIED' | 'INVALID';
  error?: string;
}

interface WorkMediaProbeAsset {
  assetKey: string;
  originalFilename: string;
  declaredMime: string;
  receivedAt: string;
  stored: StoredMedia;
  absolutePath: string;
}

interface WorkMediaProbeSession {
  probeId: string;
  runId: string;
  userId: string;
  clientId: string;
  date: string | null;
  createdAt: string;
  expiresAtMs: number;
  tokenHash: string;
  assets: Map<string, WorkMediaProbeAsset>;
  totalBytes: number;
}

const sessions = new Map<string, WorkMediaProbeSession>();

function nowIso(): string {
  return new Date().toISOString();
}

function tokenHash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeRootPath(root: string): string {
  return path.resolve(root);
}

function probeDirectory(probeId: string): string {
  if (!PROBE_ID_PATTERN.test(probeId)) throw new WorkMediaProbeError('probeId 无效', 400, 'INVALID_PROBE_ID');
  const root = safeRootPath(ROOT);
  const target = path.resolve(root, probeId);
  if (!target.startsWith(root + path.sep)) throw new WorkMediaProbeError('Probe 存储路径不安全', 400, 'UNSAFE_PROBE_PATH');
  return target;
}

function assertAssetKey(assetKey: string): void {
  if (!ASSET_KEY_PATTERN.test(assetKey)) throw new WorkMediaProbeError('assetKey 无效', 400, 'INVALID_ASSET_KEY');
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WorkMediaProbeError('date 必须是有效的 YYYY-MM-DD 日期', 400, 'INVALID_DATE');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new WorkMediaProbeError('date 必须是有效的 YYYY-MM-DD 日期', 400, 'INVALID_DATE');
  }
  return value;
}

function normalizeFilename(value: string | undefined, assetKey: string): string {
  const filename = value?.trim() || assetKey;
  if (!filename || filename.length > 240 || Buffer.byteLength(filename, 'utf8') > 512 || filename.includes('\0')) {
    throw new WorkMediaProbeError('原始文件名无效或过长', 400, 'INVALID_FILENAME');
  }
  return filename;
}

function cleanupExpiredSessions(now = Date.now()): void {
  for (const [probeId, session] of sessions) {
    if (session.expiresAtMs <= now) sessions.delete(probeId);
  }
}

/** Remove only stale entries inside the dedicated Probe root. */
export function cleanupWorkMediaProbeStorage(now = Date.now()): void {
  cleanupExpiredSessions(now);
  fs.mkdirSync(ROOT, { recursive: true });
  const cutoff = now - WORK_MEDIA_PROBE_TTL_MS;
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    const target = path.resolve(ROOT, entry.name);
    if (!target.startsWith(safeRootPath(ROOT) + path.sep)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      continue;
    }
    if (stat.mtimeMs >= cutoff) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // A later probe can retry cleanup; upload correctness must not depend on GC.
    }
  }
}

export function workMediaProbeRoot(): string {
  fs.mkdirSync(ROOT, { recursive: true });
  return ROOT;
}

export function isWorkMediaProbeEnabled(): boolean {
  return process.env.WORK_MEDIA_PROBE_ENABLED === 'true';
}

export function createWorkMediaProbe(input: {
  userId: string;
  clientId: string;
  date?: string;
}): WorkMediaProbeTicket {
  if (!input.userId || !input.clientId) throw new WorkMediaProbeError('Probe 缺少账号上下文', 401, 'MISSING_ACCOUNT');
  cleanupWorkMediaProbeStorage();
  const probeId = crypto.randomUUID();
  const runId = `work-media-probe-${probeId}`;
  const createdAt = nowIso();
  const expiresAtMs = Date.now() + WORK_MEDIA_PROBE_TTL_MS;
  const uploadToken = crypto.randomBytes(32).toString('base64url');
  const date = normalizeDate(input.date);
  sessions.set(probeId, {
    probeId,
    runId,
    userId: input.userId,
    clientId: input.clientId,
    date,
    createdAt,
    expiresAtMs,
    tokenHash: tokenHash(uploadToken),
    assets: new Map(),
    totalBytes: 0,
  });
  return {
    probeId,
    runId,
    date,
    createdAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    uploadToken,
    transport: 'raw-http-put',
    maxBytesPerFile: WORK_MEDIA_PROBE_MAX_BYTES,
    maxFiles: WORK_MEDIA_PROBE_MAX_FILES,
    maxTotalBytes: WORK_MEDIA_PROBE_MAX_TOTAL_BYTES,
  };
}

function requireSession(probeId: string): WorkMediaProbeSession {
  cleanupExpiredSessions();
  const session = sessions.get(probeId);
  if (!session) throw new WorkMediaProbeError('Probe 不存在、已过期或已清理', 404, 'PROBE_NOT_FOUND');
  return session;
}

function requireUploadSession(probeId: string, uploadToken: string): WorkMediaProbeSession {
  const session = requireSession(probeId);
  if (!uploadToken || uploadToken.length > 512 || !/^[A-Za-z0-9_-]{16,512}$/.test(uploadToken)) {
    throw new WorkMediaProbeError('Probe 上传票据无效', 401, 'INVALID_UPLOAD_TOKEN');
  }
  const suppliedHash = tokenHash(uploadToken);
  if (suppliedHash.length !== TOKEN_HASH_HEX_LENGTH || !crypto.timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(session.tokenHash))) {
    throw new WorkMediaProbeError('Probe 上传票据无效', 401, 'INVALID_UPLOAD_TOKEN');
  }
  return session;
}

function verifyAsset(session: WorkMediaProbeSession, asset: WorkMediaProbeAsset): WorkMediaProbeAssetSummary {
  try {
    if (!fs.existsSync(asset.absolutePath)) throw new Error('服务器文件不存在');
    const stat = fs.statSync(asset.absolutePath);
    if (!stat.isFile() || stat.size !== asset.stored.sizeBytes) throw new Error('服务器文件大小不一致');
    const body = fs.readFileSync(asset.absolutePath);
    const validated = validateDailyReportMediaBuffer(body, asset.declaredMime);
    if (validated.sha256 !== asset.stored.sha256 || validated.mimeType !== asset.stored.mimeType || validated.sizeBytes !== asset.stored.sizeBytes) {
      throw new Error('服务器文件校验值不一致');
    }
    return {
      assetKey: asset.assetKey,
      originalFilename: asset.originalFilename,
      declaredMime: asset.declaredMime,
      detectedMime: validated.mimeType,
      bytes: validated.sizeBytes,
      sha256: validated.sha256,
      receivedAt: asset.receivedAt,
      assetId: `${session.probeId}/${asset.stored.filename}`,
      completeRead: true,
      integrity: 'VERIFIED',
    };
  } catch (error) {
    return {
      assetKey: asset.assetKey,
      originalFilename: asset.originalFilename,
      declaredMime: asset.declaredMime,
      detectedMime: asset.stored.mimeType || null,
      bytes: asset.stored.sizeBytes,
      sha256: asset.stored.sha256,
      receivedAt: asset.receivedAt,
      assetId: `${session.probeId}/${asset.stored.filename}`,
      completeRead: false,
      integrity: 'INVALID',
      error: error instanceof Error ? error.message : '服务器文件校验失败',
    };
  }
}

export function uploadWorkMediaProbeAsset(input: {
  probeId: string;
  uploadToken: string;
  assetKey: string;
  originalFilename?: string;
  declaredMime?: string;
  buffer: Buffer;
}): WorkMediaProbeAssetSummary {
  const session = requireUploadSession(input.probeId, input.uploadToken);
  assertAssetKey(input.assetKey);
  if (session.assets.has(input.assetKey)) throw new WorkMediaProbeError('assetKey 已上传，禁止覆盖 Probe 文件', 409, 'DUPLICATE_ASSET_KEY');
  if (session.assets.size >= WORK_MEDIA_PROBE_MAX_FILES) {
    throw new WorkMediaProbeError(`Probe 文件数量超过上限 ${WORK_MEDIA_PROBE_MAX_FILES}`, 413, 'FILE_COUNT_LIMIT');
  }
  if (!Buffer.isBuffer(input.buffer)) throw new WorkMediaProbeError('Probe 请求正文必须是原始文件字节', 400, 'BODY_NOT_BINARY');
  if (input.buffer.length > WORK_MEDIA_PROBE_MAX_BYTES) {
    throw new WorkMediaProbeError('Probe 单文件超过 5 MiB 限制', 413, 'FILE_SIZE_LIMIT');
  }
  if (session.totalBytes + input.buffer.length > WORK_MEDIA_PROBE_MAX_TOTAL_BYTES) {
    throw new WorkMediaProbeError('Probe 批次总大小超过限制', 413, 'TOTAL_SIZE_LIMIT');
  }
  const originalFilename = normalizeFilename(input.originalFilename, input.assetKey);
  const declaredMime = String(input.declaredMime || '').trim().slice(0, 200);
  const validated = validateDailyReportMediaBuffer(input.buffer, declaredMime);
  const directory = probeDirectory(session.probeId);
  fs.mkdirSync(directory, { recursive: true });
  const stored = storeProvidedDailyReportMedia(validated.filename, input.buffer, validated.mimeType, directory);
  const asset: WorkMediaProbeAsset = {
    assetKey: input.assetKey,
    originalFilename,
    declaredMime,
    receivedAt: nowIso(),
    stored,
    absolutePath: path.join(directory, stored.filename),
  };
  session.assets.set(asset.assetKey, asset);
  session.totalBytes += stored.sizeBytes;
  return verifyAsset(session, asset);
}

export function getWorkMediaProbeStatus(probeId: string, userId: string): Record<string, unknown> {
  const session = requireSession(probeId);
  if (session.userId !== userId) throw new WorkMediaProbeError('无权查看该 Probe', 403, 'PROBE_OWNERSHIP_ERROR');
  const files = [...session.assets.values()].map(asset => verifyAsset(session, asset));
  return {
    status: 'OPEN',
    probeId: session.probeId,
    runId: session.runId,
    date: session.date,
    createdAt: session.createdAt,
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    transport: 'raw-http-put',
    limits: {
      mcpRequestMaxBytes: 1_000_000,
      maxBytesPerFile: WORK_MEDIA_PROBE_MAX_BYTES,
      maxFiles: WORK_MEDIA_PROBE_MAX_FILES,
      maxTotalBytes: WORK_MEDIA_PROBE_MAX_TOTAL_BYTES,
    },
    uploadedCount: files.length,
    totalBytes: session.totalBytes,
    completeRead: files.every(file => file.completeRead),
    hashesVerified: files.filter(file => file.integrity === 'VERIFIED').length,
    files,
  };
}
