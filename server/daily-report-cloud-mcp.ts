import express from 'express';
import * as db from './db.js';
import { publishDailyReport } from './daily-report-service.js';
import {
  authenticateDailyReportCloudAccessToken,
  DAILY_REPORT_CLOUD_MCP_PROTOCOL_VERSION,
  dailyReportCloudIssuer,
  extractBearerToken,
  type DailyReportCloudScope,
  type OAuthBearerContext,
} from './daily-report-cloud-auth.js';
import {
  getDailyReportCloudContext,
  isValidDailyReportCloudDate,
  listDailyReportCloudActivity,
  listDailyReportCloudHistory,
} from './daily-report-cloud-store.js';
import { getSchedulesByDate } from './schedule-store.js';
import { readUserMail } from './user-mail-service.js';
import { localizeDailyDigestImages, summarizeDailyReportMedia } from './daily-report-media-service.js';

const MAX_MCP_BODY_BYTES = 1_000_000;
const CLOUD_MARKER = '<!-- daily-digest.v1 -->';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const toolDefinitions: McpTool[] = [
  {
    name: 'daily_report.read_inputs',
    description: '读取指定日期的日报输入：日程、未读邮件摘要、云端 Context、活动证据和最近日报去重摘要。邮箱授权码永远不会返回；新闻与市场公开资料由 Work 任务通过网络获取。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD；默认使用服务端 Asia/Shanghai 日期' } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.read_calendar',
    description: '读取当前账号指定日期的日程，不包含未安排占位项。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.read_mail',
    description: '读取当前账号 QQ 邮箱的未读摘要，只返回主题、发件人、时间和正文摘要，不返回邮箱授权码。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.read_context',
    description: '读取当前账号已经确认的最小化日报 Context 与活动证据。',
    inputSchema: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'YYYY-MM-DD' },
        toDate: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.read_history',
    description: '读取最近日报的日期、摘要、内容哈希和更新时间，用于避免重复选题。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 7 } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.publish',
    description: '在服务端校验并发布日报；服务端负责媒体下载、哈希化、托管和按账号设置排队邮件。先使用 dry_run=true 验证，确认结构和媒体后再正式发布。',
    inputSchema: {
      type: 'object',
      required: ['date', 'markdown'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        markdown: { type: 'string', description: '包含 daily-digest.v1 标记的清洗后 Markdown' },
        dry_run: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
];

const TOOL_SCOPES: Record<string, DailyReportCloudScope[]> = {
  'daily_report.read_inputs': [
    'daily_report:read_calendar',
    'daily_report:read_mail',
    'daily_report:read_context',
    'daily_report:read_history',
  ],
  'daily_report.read_calendar': ['daily_report:read_calendar'],
  'daily_report.read_mail': ['daily_report:read_mail'],
  'daily_report.read_context': ['daily_report:read_context'],
  'daily_report.read_history': ['daily_report:read_history'],
  'daily_report.publish': ['daily_report:publish'],
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validDateOrToday(value: unknown, timezone: string): string {
  const requested = stringValue(value);
  if (requested) {
    if (!isValidDailyReportCloudDate(requested)) throw new Error('date 必须是有效的 YYYY-MM-DD 日期');
    return requested;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateKeyInTimezone(value: string, timezone: string, allDay: boolean): string {
  if (allDay || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function readCalendar(userId: string, date: string): Record<string, unknown> {
  const preference = db.getReminder(userId);
  const timezone = preference?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
  const schedules = getSchedulesByDate(date, userId)
    .filter(item => !item.is_unscheduled && dateKeyInTimezone(item.start_time, timezone, item.all_day) === date)
    .map(item => ({
      title: item.title,
      startTime: item.start_time,
      endTime: item.end_time || null,
      allDay: item.all_day,
      location: item.location || null,
      notes: item.notes || null,
      category: item.category,
      priority: item.priority,
      completed: item.is_completed,
    }));
  return { date, timezone, generatedAt: new Date().toISOString(), schedules };
}

function readMail(userId: string, rawLimit: unknown): Promise<Record<string, unknown>> {
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit 必须是 1 到 100 之间的整数');
  return readUserMail(userId, limit).then(result => ({ ...result, generatedAt: new Date().toISOString() }));
}

function assertCloudMarkdown(date: string, markdown: unknown): asserts markdown is string {
  if (!isValidDailyReportCloudDate(date)) throw new Error('date 必须是有效的 YYYY-MM-DD 日期');
  if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('日报正文不能为空');
  if (Buffer.byteLength(markdown, 'utf8') > 800_000) throw new Error('日报正文超过大小限制');
  if (!markdown.includes(CLOUD_MARKER)) throw new Error('云端日报必须使用 daily-digest.v1 结构化标记');
  if (!/^# Daily Digest\b/m.test(markdown) || !/^## Today at a Glance\b/m.test(markdown)) {
    throw new Error('云端日报缺少必要的 Newsletter 标题');
  }
  if (/(?:\bdrr_[A-Za-z0-9_-]{16,}|\bBearer\s+\S+|\bAuthorization\b|\b(?:api[_ -]?key|password|secret|auth[_ -]?code)\b|(?:[A-Za-z]:\\|\\\\[^\r\n ]+\\|\/Users\/|\/home\/))/i.test(markdown)) {
    throw new Error('日报正文触发凭据或本地路径安全检查');
  }
}

function toolScopeAllowed(auth: OAuthBearerContext, toolName: string): boolean {
  return (TOOL_SCOPES[toolName] || []).every(scope => auth.scopes.includes(scope));
}

async function callTool(auth: OAuthBearerContext, name: string, rawArguments: unknown): Promise<Record<string, unknown>> {
  if (!toolScopeAllowed(auth, name)) throw new Error('当前连接没有该工具所需的 scope');
  const args = objectValue(rawArguments);
  if (name === 'daily_report.read_calendar') {
    const timezone = db.getReminder(auth.userId)?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
    return readCalendar(auth.userId, validDateOrToday(args.date, timezone));
  }
  if (name === 'daily_report.read_mail') return readMail(auth.userId, args.limit);
  if (name === 'daily_report.read_context') {
    return {
      context: getDailyReportCloudContext(auth.userId),
      activity: listDailyReportCloudActivity(auth.userId, {
        fromDate: stringValue(args.fromDate) || undefined,
        toDate: stringValue(args.toDate) || undefined,
        limit: args.limit === undefined ? 100 : Number(args.limit),
      }),
      generatedAt: new Date().toISOString(),
    };
  }
  if (name === 'daily_report.read_history') {
    const limit = args.limit === undefined ? 7 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error('limit 必须是 1 到 30 之间的整数');
    return { reports: listDailyReportCloudHistory(auth.userId, limit), generatedAt: new Date().toISOString() };
  }
  if (name === 'daily_report.read_inputs') {
    const timezone = db.getReminder(auth.userId)?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
    const date = validDateOrToday(args.date, timezone);
    const [mail] = await Promise.all([readMail(auth.userId, 20)]);
    return {
      date,
      generatedAt: new Date().toISOString(),
      calendar: readCalendar(auth.userId, date),
      mail,
      cloudContext: getDailyReportCloudContext(auth.userId),
      activity: listDailyReportCloudActivity(auth.userId, { limit: 100 }),
      history: listDailyReportCloudHistory(auth.userId, 7),
    };
  }
  if (name === 'daily_report.publish') {
    const date = stringValue(args.date);
    assertCloudMarkdown(date, args.markdown);
    // dry-run 也在服务端完成媒体下载、签名校验和哈希缓存，保证正式调用不会才发现云端无法托管图片/logo。
    const localizedMarkdown = await localizeDailyDigestImages(args.markdown, {
      requireHostedMedia: false,
      requireAllMedia: true,
      inferSourceLogos: true,
    });
    const media = summarizeDailyReportMedia(localizedMarkdown);
    if (args.dry_run === true) {
      return {
        status: 'VALIDATED_NOT_PUBLISHED',
        date,
        mediaCount: media.mediaCount,
        imageCount: media.imageCount,
        logoCount: media.logoCount,
      };
    }
    const result = await publishDailyReport(auth.userId, date, localizedMarkdown, { requireHostedMedia: true });
    return {
      status: 'PUBLISHED',
      date,
      reportStatus: result.reportStatus,
      emailStatus: result.emailStatus,
      contentHash: result.report.contentHash,
      mediaCount: media.mediaCount,
      imageCount: media.imageCount,
      logoCount: media.logoCount,
      report: {
        headline: result.report.headline,
        excerpt: result.report.excerpt,
        publishedAt: result.report.publishedAt,
        updatedAt: result.report.updatedAt,
      },
    };
  }
  throw new Error('未知的日报工具');
}

function rpcError(id: JsonRpcId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function authorisedContext(req: express.Request, res: express.Response, scopes: readonly DailyReportCloudScope[] = []): OAuthBearerContext | null {
  const token = extractBearerToken(req.header('authorization'));
  const auth = authenticateDailyReportCloudAccessToken(token, scopes);
  if (auth) return auth;
  res.setHeader('WWW-Authenticate', `Bearer realm="daily-report", resource_metadata="${dailyReportCloudIssuer()}/.well-known/oauth-protected-resource/mcp"`);
  res.status(401).json({ error: 'OAuth access token 无效、已过期或 scope 不足' });
  return null;
}

async function handleJsonRpc(request: JsonRpcRequest, auth: OAuthBearerContext): Promise<Record<string, unknown> | null> {
  const id = request.id === undefined ? null : request.id;
  const method = stringValue(request.method);
  if (request.jsonrpc !== '2.0' || !method) return rpcError(id, -32600, 'Invalid Request');
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: DAILY_REPORT_CLOUD_MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-calendar-daily-report', version: 'cloud-v1' },
      },
    };
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: toolDefinitions } };
  }
  if (method === 'tools/call') {
    const params = objectValue(request.params);
    const name = stringValue(params.name);
    if (!toolDefinitions.some(tool => tool.name === name)) return rpcError(id, -32602, 'Unknown tool');
    try {
      const payload = await callTool(auth, name, params.arguments);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: false,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '日报工具调用失败';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: message }],
          isError: true,
        },
      };
    }
  }
  return rpcError(id, -32601, 'Method not found');
}

export function createDailyReportCloudMcpRouter(): express.Router {
  const router = express.Router();
  router.post('/', async (req, res) => {
    const auth = authorisedContext(req, res);
    if (!auth) return;
    const body = req.body as JsonRpcRequest;
    if (Buffer.byteLength(JSON.stringify(body || {}), 'utf8') > MAX_MCP_BODY_BYTES) return res.status(413).json(rpcError(body?.id ?? null, -32000, 'Request too large'));
    const response = await handleJsonRpc(body || {}, auth);
    res.setHeader('MCP-Protocol-Version', DAILY_REPORT_CLOUD_MCP_PROTOCOL_VERSION);
    if (!response) return res.status(202).end();
    res.setHeader('Cache-Control', 'no-store').type('application/json').json(response);
  });
  router.get('/', (_req, res) => res.status(405).setHeader('Allow', 'POST').json({ error: 'MCP endpoint 只接受 POST' }));
  return router;
}

export { toolDefinitions, callTool };
