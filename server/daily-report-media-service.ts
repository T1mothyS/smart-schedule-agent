import crypto from 'node:crypto';
import * as dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const ROOT = path.join(DATA_DIR, 'daily-report-media');

export const DAILY_REPORT_MEDIA_ROUTE = '/daily-report-media';
export const DAILY_REPORT_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const DAILY_REPORT_MEDIA_MAX_COUNT = 20;
const DAILY_REPORT_MEDIA_TIMEOUT_MS = 15_000;
const DAILY_REPORT_MEDIA_MAX_REDIRECTS = 3;
const DAILY_REPORT_MEDIA_CONCURRENCY = 4;
const STORED_MEDIA_FILENAME = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/;
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

type FetchLike = typeof fetch;
type LookupAddress = { address: string; family: 4 | 6 };
type LookupLike = (hostname: string) => Promise<LookupAddress[]>;

export interface DailyReportMediaOptions {
  fetcher?: FetchLike;
  lookup?: LookupLike;
  mediaRoot?: string;
  publicOrigin?: string;
  timeoutMs?: number;
}

interface StoredMedia {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dns.lookup(hostname, { all: true, verbatim: true }) as Promise<LookupAddress[]>;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || first >= 224;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return !!mappedIpv4 && isBlockedIpv4(mappedIpv4[1]);
}

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.lan')
    || normalized.endsWith('.home.arpa');
}

async function assertPublicUpstreamUrl(value: string, lookup: LookupLike): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('图片地址不是有效 URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('图片地址协议或格式不受支持');
  }
  if (isBlockedHostname(parsed.hostname) || isBlockedAddress(parsed.hostname)) {
    throw new Error('图片地址指向不允许的网络地址');
  }
  const addresses = await lookup(parsed.hostname);
  if (!addresses.length || addresses.some(item => isBlockedAddress(item.address))) {
    throw new Error('图片地址未解析到公开网络地址');
  }
  return parsed;
}

function detectedImageMime(buffer: Buffer): string | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('图片超过大小限制');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('图片响应没有正文');
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('图片超过大小限制');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function saveMedia(buffer: Buffer, mimeType: string, mediaRoot: string): StoredMedia {
  const root = path.resolve(mediaRoot);
  fs.mkdirSync(root, { recursive: true });
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${sha256}${extensionForMime(mimeType)}`;
  const target = path.resolve(root, filename);
  if (!target.startsWith(root + path.sep)) throw new Error('日报图片路径不安全');
  if (!fs.existsSync(target)) {
    const temporary = path.join(root, `.${filename}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, buffer, { flag: 'wx' });
      try {
        fs.renameSync(temporary, target);
      } catch (error) {
        if (!fs.existsSync(target)) throw error;
      }
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return { filename, mimeType, sizeBytes: buffer.length, sha256 };
}

async function downloadAndStoreImage(url: string, options: Required<Pick<DailyReportMediaOptions, 'fetcher' | 'lookup' | 'mediaRoot' | 'timeoutMs'>>): Promise<StoredMedia> {
  let currentUrl = url;
  for (let redirect = 0; redirect <= DAILY_REPORT_MEDIA_MAX_REDIRECTS; redirect += 1) {
    const current = await assertPublicUpstreamUrl(currentUrl, options.lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await options.fetcher(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.8',
          'User-Agent': 'AI-Calendar-DailyDigest/1.0',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        if (redirect === DAILY_REPORT_MEDIA_MAX_REDIRECTS) throw new Error('图片重定向次数过多');
        const location = response.headers.get('location');
        if (!location) throw new Error('图片重定向缺少目标地址');
        currentUrl = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) throw new Error(`图片上游返回 HTTP ${response.status}`);
      const body = await readBoundedBody(response, DAILY_REPORT_MEDIA_MAX_BYTES);
      const mimeType = detectedImageMime(body);
      if (!mimeType || !ALLOWED_IMAGE_MIME.has(mimeType)) throw new Error('图片内容不是受支持的有效图片');
      const declaredMime = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== mimeType && !(declaredMime === 'image/jpg' && mimeType === 'image/jpeg')) {
        throw new Error('图片响应类型与内容不一致');
      }
      return saveMedia(body, mimeType, options.mediaRoot);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('图片下载超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('图片下载失败');
}

function configuredPublicOrigin(): string {
  const fallback = 'http://localhost:3000';
  try {
    const parsed = new URL(String(process.env.APP_URL || fallback));
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return fallback;
    return parsed.origin;
  } catch {
    return fallback;
  }
}

export function getDailyReportMediaPublicOrigin(): string {
  return configuredPublicOrigin();
}

export function dailyReportMediaRoot(): string {
  fs.mkdirSync(ROOT, { recursive: true });
  return ROOT;
}

export function dailyReportMediaPath(value: string): string | null {
  let pathname: string;
  let parsed: URL;
  try {
    parsed = new URL(value, 'https://daily-report.invalid');
    pathname = parsed.pathname;
  } catch {
    return null;
  }
  if (parsed.search || parsed.hash) return null;
  const expectedPrefix = `${DAILY_REPORT_MEDIA_ROUTE}/`;
  if (!pathname.startsWith(expectedPrefix)) return null;
  const filename = pathname.slice(expectedPrefix.length);
  return STORED_MEDIA_FILENAME.test(filename) ? pathname : null;
}

function existingMediaUrl(value: string, publicOrigin: string): string | null {
  const mediaPath = dailyReportMediaPath(value);
  if (!mediaPath) return null;
  if (value.startsWith(DAILY_REPORT_MEDIA_ROUTE)) return `${publicOrigin}${mediaPath}`;
  try {
    const parsed = new URL(value);
    return parsed.origin === publicOrigin ? `${publicOrigin}${mediaPath}` : null;
  } catch {
    return null;
  }
}

function imageValues(markdown: string): string[] {
  const values: string[] = [];
  const pattern = /^[^\S\r\n]*图片：([^\s\r\n]+)[^\S\r\n]*$/gm;
  for (const match of markdown.matchAll(pattern)) {
    const value = match[1]?.trim() || '';
    if (value && value !== '—') values.push(value);
  }
  return values;
}

async function mapWithConcurrency(items: string[], concurrency: number, worker: (item: string) => Promise<void>): Promise<void> {
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

export async function localizeDailyDigestImages(markdown: string, options: DailyReportMediaOptions = {}): Promise<string> {
  if (!markdown.includes('<!-- daily-digest.v1 -->')) return markdown;
  const publicOrigin = options.publicOrigin || configuredPublicOrigin();
  const mediaRoot = options.mediaRoot || ROOT;
  const fetcher = options.fetcher || fetch;
  const lookup = options.lookup || defaultLookup;
  const timeoutMs = options.timeoutMs || DAILY_REPORT_MEDIA_TIMEOUT_MS;
  const values = [...new Set(imageValues(markdown))];
  const replacements = new Map<string, string>();
  const pending: string[] = [];
  for (const value of values) {
    const existing = existingMediaUrl(value, publicOrigin);
    if (existing) replacements.set(value, existing);
    else if (pending.length < DAILY_REPORT_MEDIA_MAX_COUNT) pending.push(value);
    else replacements.set(value, '—');
  }

  await mapWithConcurrency(pending, DAILY_REPORT_MEDIA_CONCURRENCY, async value => {
    try {
      const stored = await downloadAndStoreImage(value, { fetcher, lookup, mediaRoot, timeoutMs });
      replacements.set(value, `${publicOrigin}${DAILY_REPORT_MEDIA_ROUTE}/${stored.filename}`);
    } catch {
      // 单张图片失败不应阻断整份日报；失败项明确降级为空图片位。
      replacements.set(value, '—');
    }
  });

  return markdown.replace(/^([^\S\r\n]*图片：)([^\s\r\n]+)([^\S\r\n]*)$/gm, (line, prefix: string, value: string, suffix: string) => {
    if (!value || value === '—') return line;
    return `${prefix}${replacements.get(value) || '—'}${suffix}`;
  });
}
