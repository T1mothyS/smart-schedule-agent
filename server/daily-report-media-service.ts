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
export const DAILY_REPORT_MEDIA_UPLOAD_ROUTE = '/api/integrations/daily-report/reports';
export const DAILY_REPORT_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const DAILY_REPORT_MEDIA_MAX_COUNT = 20;
const DAILY_REPORT_MEDIA_TIMEOUT_MS = 15_000;
const DAILY_REPORT_MEDIA_MAX_REDIRECTS = 3;
const DAILY_REPORT_MEDIA_CONCURRENCY = 4;
const STORED_MEDIA_FILENAME = /^[a-f0-9]{64}\.(?:jpg|png|webp|ico|svg)$/;
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml']);
const SOURCE_ICON_URLS: Record<string, string> = {
  BBC: 'https://www.bbc.com/favicon.ico',
  新华社: 'https://www.xinhuanet.com/favicon.ico',
  人民网: 'https://www.people.com.cn/favicon.ico',
  央视新闻: 'https://news.cctv.com/favicon.ico',
  光明网: 'https://www.gmw.cn/favicon.ico',
  财新: 'https://www.caixin.com/favicon.ico',
  新浪新闻: 'https://news.sina.com.cn/favicon.ico',
  网易新闻: 'https://news.163.com/favicon.ico',
  'Federal Reserve': 'https://www.federalreserve.gov/favicon.ico',
  SEC: 'https://www.sec.gov/favicon.ico',
  OpenAI: 'https://svgl.app/library/openai.svg',
  'Google AI': 'https://www.google.com/favicon.ico',
  'Yahoo Finance': 'https://finance.yahoo.com/favicon.ico',
  'Yahoo Finance chart': 'https://finance.yahoo.com/favicon.ico',
};

type FetchLike = typeof fetch;
type LookupAddress = { address: string; family: 4 | 6 };
type LookupLike = (hostname: string) => Promise<LookupAddress[]>;

export interface DailyReportMediaOptions {
  fetcher?: FetchLike;
  lookup?: LookupLike;
  mediaRoot?: string;
  publicOrigin?: string;
  timeoutMs?: number;
  requireHostedMedia?: boolean;
  requireAllMedia?: boolean;
  inferSourceLogos?: boolean;
}

export interface StoredMedia {
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

function isSafeSvg(buffer: Buffer): boolean {
  let source: string;
  try {
    source = buffer.toString('utf8');
  } catch {
    return false;
  }
  if (!/<svg\b/i.test(source)) return false;
  return !/<\s*(?:script|foreignObject)\b|\bon[a-z][\w-]*\s*=|(?:href|src|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)/i.test(source);
}

function detectedImageMime(buffer: Buffer): string | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && buffer.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) && buffer.readUInt16LE(4) > 0) return 'image/x-icon';
  if (isSafeSvg(buffer)) return 'image/svg+xml';
  return null;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/x-icon' || mimeType === 'image/vnd.microsoft.icon') return '.ico';
  if (mimeType === 'image/svg+xml') return '.svg';
  return '.jpg';
}

function normalizedDeclaredMime(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function assertDeclaredMime(declaredMime: string, detectedMime: string): void {
  if (!declaredMime || declaredMime === 'application/octet-stream' || declaredMime === 'binary/octet-stream') return;
  const normalized = declaredMime === 'image/jpg' ? 'image/jpeg' : declaredMime === 'image/vnd.microsoft.icon' ? 'image/x-icon' : declaredMime;
  if (normalized !== detectedMime) throw new Error('媒体响应类型与内容不一致');
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

export function storeProvidedDailyReportMedia(
  filename: string,
  buffer: Buffer,
  declaredMime = '',
  mediaRoot = ROOT,
): StoredMedia {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('日报媒体正文不能为空');
  if (buffer.length > DAILY_REPORT_MEDIA_MAX_BYTES) throw new Error('日报媒体超过大小限制');
  if (!STORED_MEDIA_FILENAME.test(filename)) throw new Error('日报媒体文件名不安全');
  const validated = validateDailyReportMediaBuffer(buffer, declaredMime);
  if (filename !== validated.filename) throw new Error('日报媒体文件名与内容哈希不一致');
  return saveMedia(buffer, validated.mimeType, mediaRoot);
}

/**
 * Validate an already received media body without touching the filesystem.
 * Probe and formal local uploads must share this exact content contract.
 */
export function validateDailyReportMediaBuffer(buffer: Buffer, declaredMime = ''): StoredMedia {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('日报媒体正文不能为空');
  if (buffer.length > DAILY_REPORT_MEDIA_MAX_BYTES) throw new Error('日报媒体超过大小限制');
  const detectedMime = detectedImageMime(buffer);
  if (!detectedMime || !ALLOWED_IMAGE_MIME.has(detectedMime)) throw new Error('日报媒体内容不是受支持的有效图片或 logo');
  assertDeclaredMime(normalizedDeclaredMime(declaredMime), detectedMime);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return {
    filename: `${sha256}${extensionForMime(detectedMime)}`,
    mimeType: detectedMime,
    sizeBytes: buffer.length,
    sha256,
  };
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
      const declaredMime = response.headers.get('content-type') || '';
      const validated = validateDailyReportMediaBuffer(body, declaredMime);
      return saveMedia(body, validated.mimeType, options.mediaRoot);
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

interface ReportMediaReference {
  label: '图片' | '来源图标';
  value: string;
}

function reportMediaReferences(markdown: string): ReportMediaReference[] {
  if (!markdown.includes('<!-- daily-digest.v1 -->')) return [];
  const references: ReportMediaReference[] = [];
  const pattern = /^[^\S\r\n]*(图片|来源图标)：([^\s\r\n]+)[^\S\r\n]*$/gm;
  for (const match of markdown.matchAll(pattern)) {
    const value = match[2]?.trim() || '';
    if (value && value !== '—') references.push({ label: match[1] as ReportMediaReference['label'], value });
  }
  return references;
}

function mediaFilePath(mediaPath: string, mediaRoot: string): string {
  const filename = mediaPath.slice(`${DAILY_REPORT_MEDIA_ROUTE}/`.length);
  const root = path.resolve(mediaRoot);
  const target = path.resolve(root, filename);
  if (!target.startsWith(root + path.sep)) throw new Error('日报媒体路径不安全');
  return target;
}

export function assertHostedDailyReportMedia(markdown: string, mediaRoot = ROOT, publicOrigin = configuredPublicOrigin()): void {
  const references = reportMediaReferences(markdown);
  const unique = new Set(references.map(reference => reference.value));
  if (unique.size > DAILY_REPORT_MEDIA_MAX_COUNT) throw new Error(`日报媒体数量超过上限 ${DAILY_REPORT_MEDIA_MAX_COUNT}`);
  for (const reference of references) {
    const mediaPath = dailyReportMediaPath(reference.value);
    const hostedUrl = mediaPath ? existingMediaUrl(reference.value, publicOrigin) : null;
    if (!mediaPath || !hostedUrl) {
      throw new Error(`${reference.label}必须先在本地上传并使用本站媒体地址`);
    }
    if (!fs.existsSync(mediaFilePath(mediaPath, mediaRoot))) {
      throw new Error(`${reference.label}对应的本站媒体文件尚未上传`);
    }
  }
}

export function summarizeDailyReportMedia(markdown: string): { mediaCount: number; imageCount: number; logoCount: number } {
  const unique = new Map<string, ReportMediaReference['label']>();
  for (const reference of reportMediaReferences(markdown)) unique.set(reference.value, reference.label);
  return {
    mediaCount: unique.size,
    imageCount: [...unique.values()].filter(label => label === '图片').length,
    logoCount: [...unique.values()].filter(label => label === '来源图标').length,
  };
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

function allMediaValues(markdown: string): string[] {
  return reportMediaReferences(markdown).map(reference => reference.value);
}

function inferDailyDigestSourceLogos(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let section = '';
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (line.startsWith('## ')) section = line;
    output.push(rawLine);
    if (!['## Lead Story', '## Category Digest', '## Worth Your Time'].includes(section) || !line.startsWith('来源：')) continue;
    const source = line.slice('来源：'.length).trim();
    const logoUrl = SOURCE_ICON_URLS[source];
    if (!logoUrl) continue;
    const next = lines[index + 1]?.trim() || '';
    if (next.startsWith('来源图标：')) {
      const existingLogo = next.slice('来源图标：'.length).trim();
      output.push(existingLogo && existingLogo !== '—' ? lines[index + 1] : `来源图标：${logoUrl}`);
      index += 1;
      continue;
    } else {
      output.push(`来源图标：${logoUrl}`);
    }
  }
  return output.join('\n');
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
  const sourceMarkdown = options.inferSourceLogos ? inferDailyDigestSourceLogos(markdown) : markdown;
  const publicOrigin = options.publicOrigin || configuredPublicOrigin();
  const mediaRoot = options.mediaRoot || ROOT;
  if (options.requireHostedMedia) {
    assertHostedDailyReportMedia(sourceMarkdown, mediaRoot, publicOrigin);
    return sourceMarkdown;
  }
  const fetcher = options.fetcher || fetch;
  const lookup = options.lookup || defaultLookup;
  const timeoutMs = options.timeoutMs || DAILY_REPORT_MEDIA_TIMEOUT_MS;
  const values = [...new Set(allMediaValues(sourceMarkdown))];
  const replacements = new Map<string, string>();
  const pending: string[] = [];
  let overLimit = false;
  for (const value of values) {
    const existing = existingMediaUrl(value, publicOrigin);
    if (existing) replacements.set(value, existing);
    else if (pending.length < DAILY_REPORT_MEDIA_MAX_COUNT) pending.push(value);
    else {
      replacements.set(value, '—');
      overLimit = true;
    }
  }

  const failures: string[] = [];
  await mapWithConcurrency(pending, DAILY_REPORT_MEDIA_CONCURRENCY, async value => {
    try {
      const stored = await downloadAndStoreImage(value, { fetcher, lookup, mediaRoot, timeoutMs });
      replacements.set(value, `${publicOrigin}${DAILY_REPORT_MEDIA_ROUTE}/${stored.filename}`);
    } catch {
      // 单张图片失败不应阻断整份日报；失败项明确降级为空图片位。
      replacements.set(value, '—');
      failures.push(value);
    }
  });

  if (options.requireAllMedia && (overLimit || failures.length > 0)) {
    throw new Error('日报媒体无法全部托管，未进入发布');
  }

  return sourceMarkdown.replace(/^([^\S\r\n]*(?:图片|来源图标)：)([^\s\r\n]+)([^\S\r\n]*)$/gm, (line, prefix: string, value: string, suffix: string) => {
    if (!value || value === '—') return line;
    return `${prefix}${replacements.get(value) || '—'}${suffix}`;
  });
}
