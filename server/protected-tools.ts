import fs from 'node:fs';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import type { createAuth } from './auth.js';

const TOOL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL_CSP_PROFILES = new Set(['inline', 'plotly-alipay']);

export type ToolCspProfile = 'inline' | 'plotly-alipay';

export interface ToolManifestItem {
  slug: string;
  title: string;
  summary: string;
  enabled: boolean;
  cspProfile: ToolCspProfile;
}

export interface ToolManifest {
  version: number;
  tools: ToolManifestItem[];
}

export interface PublicTool {
  slug: string;
  title: string;
  summary: string;
  path: string;
  kind: 'mounted';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`工具清单第 ${index + 1} 项的 ${field} 无效`);
  }
  return value.trim();
}

export function readToolsManifest(root: string): ToolManifest {
  const filename = path.join(path.resolve(root), 'manifest.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取工具清单: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) {
    throw new Error('工具清单格式无效');
  }
  const version = typeof parsed.version === 'number' && Number.isInteger(parsed.version) ? parsed.version : 1;
  const seen = new Set<string>();
  const tools = parsed.tools.map((candidate, index): ToolManifestItem => {
    if (!isRecord(candidate)) throw new Error(`工具清单第 ${index + 1} 项格式无效`);
    const slug = requiredText(candidate.slug, 'slug', index);
    if (!TOOL_SLUG_PATTERN.test(slug) || slug.length > 80) {
      throw new Error(`工具清单第 ${index + 1} 项的 slug 无效`);
    }
    if (seen.has(slug)) throw new Error(`工具清单包含重复 slug: ${slug}`);
    seen.add(slug);
    const title = requiredText(candidate.title, 'title', index);
    const summary = requiredText(candidate.summary, 'summary', index);
    const cspProfile = candidate.cspProfile === undefined ? 'inline' : candidate.cspProfile;
    if (typeof cspProfile !== 'string' || !TOOL_CSP_PROFILES.has(cspProfile)) {
      throw new Error(`工具 ${slug} 的 cspProfile 无效`);
    }
    if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') {
      throw new Error(`工具 ${slug} 的 enabled 无效`);
    }
    return {
      slug,
      title,
      summary,
      enabled: candidate.enabled !== false,
      cspProfile: cspProfile as ToolCspProfile,
    };
  });
  return { version, tools };
}

export function getPublicTools(root: string): PublicTool[] {
  return readToolsManifest(root).tools
    .filter(tool => tool.enabled)
    .map(tool => ({
      slug: tool.slug,
      title: tool.title,
      summary: tool.summary,
      path: `/tools/${tool.slug}/`,
      kind: 'mounted' as const,
    }));
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toolNotFound(res: Parameters<RequestHandler>[1]): void {
  res.status(404).type('text/plain').send('工具不存在');
}

function toolCsp(profile: ToolCspProfile): string {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  const frameSources: string[] = [];
  if (profile === 'plotly-alipay') {
    scriptSources.push('https://cdn.plot.ly');
    frameSources.push('https://render.alipay.com');
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    ...(frameSources.length ? [`frame-src ${frameSources.join(' ')}`] : []),
  ].join('; ');
}

function setToolHeaders(res: Parameters<RequestHandler>[1], profile: ToolCspProfile): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Content-Security-Policy', toolCsp(profile));
}

export function createToolsApiRouter({ authenticate, root }: Pick<ReturnType<typeof createAuth>, 'authenticate'> & { root: string }) {
  const router = Router();
  router.get('/api/tools', authenticate, (_req, res) => {
    try {
      res.json({ tools: getPublicTools(root) });
    } catch (error) {
      console.error('[Tools] 工具清单读取失败:', error);
      res.status(500).json({ error: '工具清单暂时不可用，请稍后再试' });
    }
  });
  return router;
}

export function createProtectedToolsRouter({
  root,
  authenticatePage,
  isReady,
}: {
  root: string;
  authenticatePage: RequestHandler;
  isReady: () => boolean;
}) {
  const router = Router();
  const toolsRoot = path.resolve(root);

  // 先做页面 Cookie 门禁，再判断清单和文件，避免未登录请求探测工具内容。
  router.use((req, res, next) => {
    if (!isReady()) return res.status(503).type('text/plain').send('服务正在初始化，请稍后再试');
    return authenticatePage(req, res, next);
  });

  router.use((req, res, next) => {
    const pathname = req.path;
    if (pathname === '/' || pathname === '') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).setHeader('Allow', 'GET, HEAD').type('text/plain').send('仅支持读取工具页面');
    }
    if (pathname.includes('\\') || pathname.includes('\0')) return toolNotFound(res);

    const segments = pathname.split('/');
    const slug = segments[1];
    if (!slug || !TOOL_SLUG_PATTERN.test(slug)) return toolNotFound(res);
    const rawRelativeSegments = segments.slice(2);
    if (rawRelativeSegments.some((segment, index) => segment === '' && index < rawRelativeSegments.length - 1)) {
      return toolNotFound(res);
    }
    const relativeSegments = rawRelativeSegments.at(-1) === '' ? rawRelativeSegments.slice(0, -1) : rawRelativeSegments;
    if (relativeSegments.some(segment => segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))) {
      return toolNotFound(res);
    }

    let manifest: ToolManifest;
    try { manifest = readToolsManifest(toolsRoot); }
    catch (error) {
      console.error('[Tools] 受保护工具清单读取失败:', error);
      return res.status(500).type('text/plain').send('工具清单暂时不可用');
    }
    const tool = manifest.tools.find(candidate => candidate.slug === slug && candidate.enabled);
    if (!tool) return toolNotFound(res);

    const toolRoot = path.resolve(toolsRoot, slug);
    if (!isInside(toolsRoot, toolRoot)) return toolNotFound(res);
    if (!pathname.endsWith('/') && relativeSegments.length === 0) {
      const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      setToolHeaders(res, tool.cspProfile);
      return res.redirect(308, `/tools/${slug}/${query}`);
    }
    const relativePath = relativeSegments.length ? path.join(...relativeSegments) : 'index.html';
    const filename = path.resolve(toolRoot, relativePath);
    if (!isInside(toolRoot, filename)) return toolNotFound(res);
    setToolHeaders(res, tool.cspProfile);
    return res.sendFile(filename, error => {
      if (error && !res.headersSent) toolNotFound(res);
    });
  });

  return router;
}
