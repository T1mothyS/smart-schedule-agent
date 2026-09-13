import crypto from 'node:crypto';

import * as db from './db.js';
import {
  DAILY_REPORT_MEDIA_MAX_BYTES,
  DAILY_REPORT_MEDIA_MAX_COUNT,
  DAILY_REPORT_MEDIA_ROUTE,
  assertHostedDailyReportMedia,
  controlledMediaFetch,
  DailyReportMediaFetchError,
  dailyReportMediaPath,
  dailyReportMediaRoot,
  getDailyReportMediaPublicOrigin,
  listDailyReportMediaReferences,
  storeProvidedDailyReportMedia,
  verifyStoredDailyReportMedia,
  type ControlledDailyReportMediaOptions,
  type DailyReportMediaFailureCode,
  type StoredMedia,
} from './daily-report-media-service.js';

export const DAILY_REPORT_MEDIA_BATCH_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
export const DAILY_REPORT_MEDIA_BATCH_TTL_MS = 2 * 60 * 60 * 1000;
export const DAILY_REPORT_MEDIA_MAX_CANDIDATES = 5;
export const DAILY_REPORT_MEDIA_MAX_URL_LENGTH = 4096;

const ASSET_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SOURCE_DOMAIN_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;

export interface MediaPrepareCandidateInput {
  url: string;
  sourceUrl?: string;
  sourceDomain?: string;
}

export interface MediaPrepareAssetInput {
  assetKey: string;
  candidates: MediaPrepareCandidateInput[];
}

export interface MediaPrepareOptions extends Pick<ControlledDailyReportMediaOptions, 'fetcher' | 'lookup' | 'timeoutMs'> {
  mediaRoot?: string;
  publicOrigin?: string;
  now?: () => number;
}

interface CandidateAttempt {
  candidate: number;
  url: string;
  reason: DailyReportMediaFailureCode;
  message: string;
  httpStatus?: number;
}

interface PreparedAssetResult {
  assetKey: string;
  status: 'HOSTED' | 'FAILED';
  selectedCandidate: number | null;
  originalUrl: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  hostedUrl: string | null;
  mime: string | null;
  bytes: number | null;
  sha256: string | null;
  attempts: CandidateAttempt[];
  reused?: boolean;
}

export interface MediaPrepareBatchSummary {
  mediaBatchId: string;
  runId: string;
  date: string;
  status: db.DbDailyReportMediaBatchStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  assetCount: number;
  hostedCount: number;
  failedCount: number;
  totalBytes: number;
}

export interface MediaPrepareStartResult extends MediaPrepareBatchSummary {
  status: 'PREPARING';
  limits: {
    maxFiles: number;
    maxBytesPerFile: number;
    maxTotalBytes: number;
    maxCandidatesPerAsset: number;
  };
}

export interface MediaPrepareResult {
  status: db.DbDailyReportMediaBatchStatus;
  batch: MediaPrepareBatchSummary;
  assets: PreparedAssetResult[];
}

export interface MediaPreparePublishCheck {
  mediaBatchId: string;
  runId: string;
  reportDate: string;
  requiredAssetKeys: unknown;
  markdown: string;
}

const batchLocks = new Map<string, Promise<void>>();

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requireDate(value: string): string {
  if (!validDate(value)) throw new Error('date 必须是有效的 YYYY-MM-DD 日期');
  return value;
}

function normalizePublicOrigin(value: string | undefined): string {
  const origin = value || getDailyReportMediaPublicOrigin();
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('invalid origin');
    }
    return parsed.origin;
  } catch {
    throw new Error('日报媒体公共地址配置无效');
  }
}

function normalizeAssetKey(value: unknown): string {
  const assetKey = stringValue(value);
  if (!ASSET_KEY_PATTERN.test(assetKey)) throw new Error('assetKey 格式无效');
  return assetKey;
}

function normalizeCandidate(value: unknown): MediaPrepareCandidateInput {
  const candidate = objectValue(value);
  const url = stringValue(candidate.url);
  if (!url || url.length > DAILY_REPORT_MEDIA_MAX_URL_LENGTH) throw new Error('图片候选 URL 不能为空或过长');
  const sourceUrl = stringValue(candidate.sourceUrl) || undefined;
  if (sourceUrl && sourceUrl.length > DAILY_REPORT_MEDIA_MAX_URL_LENGTH) throw new Error('sourceUrl 过长');
  if (sourceUrl) {
    let parsed: URL;
    try { parsed = new URL(sourceUrl); } catch { throw new Error('sourceUrl 不是有效 URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('sourceUrl 协议或格式不受支持');
  }
  const sourceDomain = stringValue(candidate.sourceDomain) || undefined;
  if (sourceDomain && !SOURCE_DOMAIN_PATTERN.test(sourceDomain)) throw new Error('sourceDomain 格式无效');
  return { url, sourceUrl, sourceDomain: sourceDomain?.toLowerCase() };
}

function normalizeAssets(value: unknown): MediaPrepareAssetInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DAILY_REPORT_MEDIA_MAX_COUNT) {
    throw new Error(`assets 必须是 1 到 ${DAILY_REPORT_MEDIA_MAX_COUNT} 个媒体条目的数组`);
  }
  const seen = new Set<string>();
  return value.map(item => {
    const object = objectValue(item);
    const assetKey = normalizeAssetKey(object.assetKey);
    if (seen.has(assetKey)) throw new Error(`assetKey 重复：${assetKey}`);
    seen.add(assetKey);
    if (!Array.isArray(object.candidates) || object.candidates.length < 1 || object.candidates.length > DAILY_REPORT_MEDIA_MAX_CANDIDATES) {
      throw new Error(`assetKey ${assetKey} 必须提供 1 到 ${DAILY_REPORT_MEDIA_MAX_CANDIDATES} 个候选 URL`);
    }
    return { assetKey, candidates: object.candidates.map(normalizeCandidate) };
  });
}

function parseAttempts(value: string | null | undefined): CandidateAttempt[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed as CandidateAttempt[] : [];
  } catch {
    return [];
  }
}

function batchSummary(batch: db.DbDailyReportMediaBatch, assets: db.DbDailyReportMediaAsset[]): MediaPrepareBatchSummary {
  const hosted = assets.filter(asset => asset.status === 'HOSTED' && asset.filename && asset.sha256 && asset.size_bytes !== null);
  const unique = new Map<string, number>();
  for (const asset of hosted) unique.set(asset.sha256!, asset.size_bytes!);
  return {
    mediaBatchId: batch.id,
    runId: batch.run_id,
    date: batch.report_date,
    status: batch.status,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    expiresAt: batch.expires_at,
    assetCount: assets.length,
    hostedCount: hosted.length,
    failedCount: assets.filter(asset => asset.status === 'FAILED').length,
    totalBytes: [...unique.values()].reduce((total, bytes) => total + bytes, 0),
  };
}

function assetResult(asset: db.DbDailyReportMediaAsset, publicOrigin: string, reused = false): PreparedAssetResult {
  return {
    assetKey: asset.asset_key,
    status: asset.status,
    selectedCandidate: asset.selected_candidate,
    originalUrl: asset.original_url,
    sourceUrl: asset.source_url,
    sourceDomain: asset.source_domain,
    hostedUrl: asset.hosted_url || (asset.filename ? `${publicOrigin}${DAILY_REPORT_MEDIA_ROUTE}/${asset.filename}` : null),
    mime: asset.mime_type,
    bytes: asset.size_bytes,
    sha256: asset.sha256,
    attempts: parseAttempts(asset.attempts_json),
    ...(reused ? { reused: true } : {}),
  };
}

function expiredBatch(batch: db.DbDailyReportMediaBatch, now: number): db.DbDailyReportMediaBatch {
  if (!['PREPARING', 'READY', 'PENDING_RETRY', 'FAILED'].includes(batch.status)) return batch;
  if (Date.parse(batch.expires_at) > now) return batch;
  return db.updateDailyReportMediaBatchStatus(batch.id, 'EXPIRED', '媒体准备批次已过期') || batch;
}

function requireOwnedBatch(
  userId: string,
  mediaBatchId: string,
  now: number,
  allowCommitted = false,
  allowExpired = false,
): db.DbDailyReportMediaBatch {
  const batch = db.getDailyReportMediaBatch(mediaBatchId);
  if (!batch || batch.user_id !== userId) throw new Error('mediaBatchId 不存在或不属于当前账号');
  const current = expiredBatch(batch, now);
  if (current.status === 'EXPIRED' && !allowExpired) throw new Error('媒体准备批次已过期');
  if (current.status === 'COMMITTED' && !allowCommitted) throw new Error('媒体准备批次已经提交，不能再次修改');
  return current;
}

async function withBatchLock<T>(batchId: string, worker: () => Promise<T>): Promise<T> {
  const previous = batchLocks.get(batchId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  batchLocks.set(batchId, current);
  await previous;
  try {
    return await worker();
  } finally {
    release();
    if (batchLocks.get(batchId) === current) batchLocks.delete(batchId);
  }
}

function batchStorageState(assets: db.DbDailyReportMediaAsset[], mediaRoot: string): { hashes: Set<string>; totalBytes: number } {
  const hashes = new Set<string>();
  let totalBytes = 0;
  for (const asset of assets) {
    if (asset.status !== 'HOSTED' || !asset.filename || !asset.sha256 || asset.size_bytes === null) continue;
    try {
      const verified = verifyStoredDailyReportMedia(asset.filename, mediaRoot);
      if (verified.sha256 !== asset.sha256 || verified.sizeBytes !== asset.size_bytes || verified.mimeType !== asset.mime_type) continue;
      if (!hashes.has(verified.sha256)) {
        hashes.add(verified.sha256);
        totalBytes += verified.sizeBytes;
      }
    } catch {
      // 失效媒体不会计入可用批次；对应 asset 会在本次重试时被重新准备。
    }
  }
  return { hashes, totalBytes };
}

function candidateMetadata(candidate: MediaPrepareCandidateInput, url: string): { sourceUrl: string | null; sourceDomain: string | null } {
  let candidateUrl: URL | null = null;
  try { candidateUrl = new URL(url); } catch {}
  let sourceDomain = candidate.sourceDomain || '';
  if (!sourceDomain) {
    try { sourceDomain = new URL(candidate.sourceUrl || url).hostname.toLowerCase(); } catch {}
  }
  return { sourceUrl: candidate.sourceUrl || null, sourceDomain: sourceDomain || candidateUrl?.hostname.toLowerCase() || null };
}

function attemptFromError(candidate: number, url: string, error: unknown): CandidateAttempt {
  const typed = error instanceof DailyReportMediaFetchError
    ? error
    : new DailyReportMediaFetchError('FETCH_ERROR', error instanceof Error ? error.message : '图片抓取失败');
  return {
    candidate,
    url,
    reason: typed.code,
    message: typed.message,
    ...(typed.httpStatus ? { httpStatus: typed.httpStatus } : {}),
  };
}

async function prepareOneAsset(
  batch: db.DbDailyReportMediaBatch,
  input: MediaPrepareAssetInput,
  options: MediaPrepareOptions,
): Promise<PreparedAssetResult> {
  const mediaRoot = options.mediaRoot || dailyReportMediaRoot();
  const publicOrigin = normalizePublicOrigin(options.publicOrigin);
  const existing = db.getDailyReportMediaAsset(batch.id, input.assetKey);
  if (existing?.status === 'HOSTED' && existing.filename && existing.sha256 && existing.size_bytes !== null) {
    try {
      const verified = verifyStoredDailyReportMedia(existing.filename, mediaRoot);
      if (verified.sha256 === existing.sha256 && verified.sizeBytes === existing.size_bytes && verified.mimeType === existing.mime_type) {
        return assetResult(existing, publicOrigin, true);
      }
    } catch {
      // 文件被删除或篡改时继续走候选回退，并覆盖旧的 HOSTED 元数据。
    }
  }

  const currentAssets = db.listDailyReportMediaAssets(batch.id);
  const storage = batchStorageState(currentAssets, mediaRoot);
  const attempts: CandidateAttempt[] = [];
  for (const [index, candidate] of input.candidates.entries()) {
    try {
      const result = await controlledMediaFetch(candidate.url, {
        fetcher: options.fetcher,
        lookup: options.lookup,
        timeoutMs: options.timeoutMs,
        mediaRoot,
        publicOrigin,
        persistMedia: (buffer, validated) => {
          if (!storage.hashes.has(validated.sha256) && storage.totalBytes + validated.sizeBytes > DAILY_REPORT_MEDIA_BATCH_MAX_TOTAL_BYTES) {
            throw new DailyReportMediaFetchError('BATCH_TOTAL_LIMIT', `媒体批次总大小超过 ${DAILY_REPORT_MEDIA_BATCH_MAX_TOTAL_BYTES} 字节`);
          }
          const stored = storeProvidedDailyReportMedia(validated.filename, buffer, validated.mimeType, mediaRoot);
          if (!storage.hashes.has(stored.sha256)) {
            storage.hashes.add(stored.sha256);
            storage.totalBytes += stored.sizeBytes;
          }
          return stored;
        },
      });
      const metadata = candidateMetadata(candidate, result.originalUrl);
      const now = new Date().toISOString();
      const saved = db.upsertDailyReportMediaAsset({
        id: existing?.id || crypto.randomUUID(),
        batch_id: batch.id,
        asset_key: input.assetKey,
        status: 'HOSTED',
        selected_candidate: index + 1,
        original_url: result.originalUrl,
        source_url: metadata.sourceUrl,
        source_domain: metadata.sourceDomain,
        hosted_url: result.hostedUrl,
        filename: result.filename,
        sha256: result.sha256,
        mime_type: result.mimeType,
        size_bytes: result.sizeBytes,
        attempts_json: JSON.stringify(attempts),
        created_at: existing?.created_at || now,
        updated_at: now,
      });
      return assetResult(saved, publicOrigin);
    } catch (error) {
      attempts.push(attemptFromError(index + 1, candidate.url, error));
    }
  }

  const now = new Date().toISOString();
  const failed = db.upsertDailyReportMediaAsset({
    id: existing?.id || crypto.randomUUID(),
    batch_id: batch.id,
    asset_key: input.assetKey,
    status: 'FAILED',
    selected_candidate: null,
    original_url: null,
    source_url: null,
    source_domain: null,
    hosted_url: null,
    filename: null,
    sha256: null,
    mime_type: null,
    size_bytes: null,
    attempts_json: JSON.stringify(attempts),
    created_at: existing?.created_at || now,
    updated_at: now,
  });
  return assetResult(failed, publicOrigin);
}

export function createDailyReportMediaPrepareBatch(
  userId: string,
  reportDate: string,
  now = Date.now(),
): MediaPrepareStartResult {
  const date = requireDate(reportDate);
  const createdAt = new Date(now).toISOString();
  const batch: db.DbDailyReportMediaBatch = {
    id: crypto.randomUUID(),
    user_id: userId,
    report_date: date,
    run_id: `cloud-media-${crypto.randomUUID()}`,
    status: 'PREPARING',
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: new Date(now + DAILY_REPORT_MEDIA_BATCH_TTL_MS).toISOString(),
    committed_at: null,
    failure_reason: null,
  };
  db.createDailyReportMediaBatch(batch);
  return {
    ...batchSummary(batch, []),
    status: 'PREPARING',
    limits: {
      maxFiles: DAILY_REPORT_MEDIA_MAX_COUNT,
      maxBytesPerFile: DAILY_REPORT_MEDIA_MAX_BYTES,
      maxTotalBytes: DAILY_REPORT_MEDIA_BATCH_MAX_TOTAL_BYTES,
      maxCandidatesPerAsset: DAILY_REPORT_MEDIA_MAX_CANDIDATES,
    },
  };
}

export async function prepareDailyReportMedia(
  userId: string,
  mediaBatchId: string,
  rawAssets: unknown,
  options: MediaPrepareOptions = {},
): Promise<MediaPrepareResult> {
  const assets = normalizeAssets(rawAssets);
  const now = options.now || (() => Date.now());
  return withBatchLock(mediaBatchId, async () => {
    const batch = requireOwnedBatch(userId, mediaBatchId, now());
    const results: PreparedAssetResult[] = [];
    for (const asset of assets) results.push(await prepareOneAsset(batch, asset, options));

    const currentAssets = db.listDailyReportMediaAssets(batch.id);
    const nextStatus: db.DbDailyReportMediaBatchStatus = currentAssets.length > 0 && currentAssets.every(asset => {
      if (asset.status !== 'HOSTED' || !asset.filename || !asset.sha256 || asset.size_bytes === null || !asset.mime_type) return false;
      try {
        const verified = verifyStoredDailyReportMedia(asset.filename, options.mediaRoot || dailyReportMediaRoot());
        return verified.sha256 === asset.sha256 && verified.sizeBytes === asset.size_bytes && verified.mimeType === asset.mime_type;
      } catch {
        return false;
      }
    }) ? 'READY' : 'PREPARING';
    const updated = db.updateDailyReportMediaBatchStatus(batch.id, nextStatus, null) || batch;
    return {
      status: updated.status,
      batch: batchSummary(updated, currentAssets),
      assets: results,
    };
  });
}

export function getDailyReportMediaPrepareStatus(userId: string, mediaBatchId: string, now = Date.now()): MediaPrepareResult {
  const batch = requireOwnedBatch(userId, mediaBatchId, now, true, true);
  const publicOrigin = normalizePublicOrigin(undefined);
  const assets = db.listDailyReportMediaAssets(batch.id);
  return {
    status: batch.status,
    batch: batchSummary(batch, assets),
    assets: assets.map(asset => assetResult(asset, publicOrigin)),
  };
}

function normalizeRequiredAssetKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DAILY_REPORT_MEDIA_MAX_COUNT) throw new Error('requiredAssetKeys 必须是 1 到 20 个 assetKey');
  const keys = value.map(normalizeAssetKey);
  if (new Set(keys).size !== keys.length) throw new Error('requiredAssetKeys 不能重复');
  return keys;
}

export function assertDailyReportMediaBatchReadyForPublish(
  userId: string,
  input: MediaPreparePublishCheck,
  options: Pick<MediaPrepareOptions, 'mediaRoot' | 'publicOrigin'> = {},
): { batch: db.DbDailyReportMediaBatch; assets: db.DbDailyReportMediaAsset[] } {
  const batch = requireOwnedBatch(userId, input.mediaBatchId, Date.now());
  if (batch.report_date !== requireDate(input.reportDate)) throw new Error('媒体批次日期与日报日期不一致');
  if (batch.run_id !== stringValue(input.runId)) throw new Error('媒体批次 runId 不一致');
  if (batch.status !== 'READY') throw new Error(`媒体批次当前状态为 ${batch.status}，不能发布`);
  const keys = normalizeRequiredAssetKeys(input.requiredAssetKeys);
  const mediaRoot = options.mediaRoot || dailyReportMediaRoot();
  const publicOrigin = normalizePublicOrigin(options.publicOrigin);
  const selected = keys.map(key => {
    const asset = db.getDailyReportMediaAsset(batch.id, key);
    if (!asset || asset.status !== 'HOSTED' || !asset.filename || !asset.sha256 || asset.size_bytes === null || !asset.mime_type || !asset.hosted_url) {
      throw new Error(`媒体批次缺少已托管的 assetKey：${key}`);
    }
    let verified: StoredMedia;
    try {
      verified = verifyStoredDailyReportMedia(asset.filename, mediaRoot);
    } catch (error) {
      throw new Error(`媒体批次 assetKey ${key} 的文件校验失败：${error instanceof Error ? error.message : '文件不可用'}`);
    }
    if (verified.sha256 !== asset.sha256 || verified.sizeBytes !== asset.size_bytes || verified.mimeType !== asset.mime_type) {
      throw new Error(`媒体批次 assetKey ${key} 的文件校验不一致`);
    }
    const expectedHostedUrl = `${publicOrigin}${DAILY_REPORT_MEDIA_ROUTE}/${asset.filename}`;
    if (asset.hosted_url !== expectedHostedUrl) throw new Error(`媒体批次 assetKey ${key} 的托管地址不一致`);
    return asset;
  });

  // 先执行现有本站媒体检查，再确认 Markdown 里的每一项都属于本批次。
  assertHostedDailyReportMedia(input.markdown, mediaRoot, publicOrigin, { verifyContentIntegrity: true });
  const allowedPaths = new Set(selected.map(asset => `${DAILY_REPORT_MEDIA_ROUTE}/${asset.filename}`));
  for (const reference of listDailyReportMediaReferences(input.markdown)) {
    const mediaPath = dailyReportMediaPath(reference.value);
    if (!mediaPath || !allowedPaths.has(mediaPath)) throw new Error(`${reference.label}没有对应的已授权媒体 assetKey`);
  }
  if (!listDailyReportMediaReferences(input.markdown).length) throw new Error('日报正文没有可核验的媒体引用');
  return { batch, assets: selected };
}

export function markDailyReportMediaBatchPendingRetry(userId: string, mediaBatchId: string, reason: string): MediaPrepareBatchSummary {
  const batch = requireOwnedBatch(userId, mediaBatchId, Date.now());
  const updated = db.updateDailyReportMediaBatchStatus(batch.id, 'PENDING_RETRY', reason.slice(0, 500)) || batch;
  return batchSummary(updated, db.listDailyReportMediaAssets(updated.id));
}

export function commitDailyReportMediaBatch(userId: string, mediaBatchId: string): MediaPrepareBatchSummary {
  const batch = requireOwnedBatch(userId, mediaBatchId, Date.now());
  if (batch.status !== 'READY') throw new Error(`媒体批次当前状态为 ${batch.status}，不能提交`);
  const updated = db.updateDailyReportMediaBatchStatus(batch.id, 'COMMITTED', null, new Date().toISOString()) || batch;
  return batchSummary(updated, db.listDailyReportMediaAssets(updated.id));
}
