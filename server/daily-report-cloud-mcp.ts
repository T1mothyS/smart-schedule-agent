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
import { assertHostedDailyReportMedia, localizeDailyDigestImages, summarizeDailyReportMedia } from './daily-report-media-service.js';
import {
  assertDailyReportMediaBatchReadyForPublish,
  commitDailyReportMediaBatch,
  createDailyReportMediaPrepareBatch,
  getDailyReportMediaPrepareStatus,
  markDailyReportMediaBatchPendingRetry,
  prepareDailyReportMedia,
} from './daily-report-media-prepare-service.js';
import { validateDailyDigestMarkdown } from './daily-digest-template.js';
import {
  createWorkMediaProbe,
  getWorkMediaProbeStatus,
  isWorkMediaProbeEnabled,
  WORK_MEDIA_PROBE_ROUTE,
} from './work-media-probe-service.js';
import {
  assertCloudDigestCompleteness,
  getCloudDigestCompletenessRequirements,
  summarizeCloudDigestCompletenessRequirements,
} from './daily-report-cloud-completeness.js';

const MAX_MCP_BODY_BYTES = 1_000_000;
const CLOUD_MARKER = '<!-- daily-digest.v1 -->';
const CLOUD_MARKDOWN_CREDENTIAL_PATTERN = /(?:\bdrr_[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b|\bAuthorization\s*:\s*(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{8,}\b|\b(?:api[_ -]?key|password|secret|auth[_ -]?code|private[_ -]?key|client[_ -]?secret)\b\s*[:=]\s*['"`]?[A-Za-z0-9+/_~.-]{8,}['"`]?)/i;
const CLOUD_MARKDOWN_LOCAL_PATH_PATTERN = /(?:[A-Za-z]:\\|\\\\[^\r\n ]+\\|\/Users\/|\/home\/)/i;

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
  securitySchemes: Array<{ type: 'oauth2'; scopes: string[] }>;
}

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
  'daily_report.media_probe_start': ['daily_report:media_probe'],
  'daily_report.media_probe_status': ['daily_report:media_probe'],
  'daily_report.media_prepare_start': ['daily_report:media_prepare'],
  'daily_report.media_prepare': ['daily_report:media_prepare'],
  'daily_report.media_prepare_status': ['daily_report:media_prepare'],
};

function oauthSecurity(toolName: string): Array<{ type: 'oauth2'; scopes: string[] }> {
  return [{ type: 'oauth2', scopes: [...(TOOL_SCOPES[toolName] || [])] }];
}

const toolDefinitions: McpTool[] = [
  {
    name: 'daily_report.read_inputs',
    securitySchemes: oauthSecurity('daily_report.read_inputs'),
    description: '读取指定日期的日报输入：日程、未读邮件摘要、云端 Context、活动证据和最近日报去重摘要。邮箱授权码永远不会返回；新闻与市场公开资料由 Work 任务通过网络获取。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD；默认使用服务端 Asia/Shanghai 日期' } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.read_calendar',
    securitySchemes: oauthSecurity('daily_report.read_calendar'),
    description: '读取当前账号指定日期的日程，不包含未安排占位项。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.read_mail',
    securitySchemes: oauthSecurity('daily_report.read_mail'),
    description: '读取当前账号 QQ 邮箱的未读摘要，只返回主题、发件人、时间和正文摘要，不返回邮箱授权码。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.read_context',
    securitySchemes: oauthSecurity('daily_report.read_context'),
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
    securitySchemes: oauthSecurity('daily_report.read_history'),
    description: '读取最近日报的日期、摘要、内容哈希和更新时间，用于避免重复选题。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 7 } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.publish',
    securitySchemes: oauthSecurity('daily_report.publish'),
    description: '在生产服务端校验并发布 Cloud 日报；服务端固定将来源标记为 cloud。新媒体批次路径必须先调用 media_prepare_start/media_prepare，之后在 dry_run 和正式发布时提供 mediaBatchId、runId 与 requiredAssetKeys；未完成正式切换前仍保留旧版兼容路径。',
    inputSchema: {
      type: 'object',
      required: ['date', 'markdown'],
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        markdown: { type: 'string', description: '包含 daily-digest.v1 标记的清洗后 Markdown' },
        dry_run: { type: 'boolean', default: false },
        mediaBatchId: { type: 'string', description: 'media_prepare_start 返回的媒体批次 ID；新 Cloud 路径必填' },
        runId: { type: 'string', description: '媒体批次绑定的 runId；新 Cloud 路径必填' },
        requiredAssetKeys: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
          description: 'Markdown 中使用的已托管媒体 assetKey 列表',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.media_probe_start',
    securitySchemes: oauthSecurity('daily_report.media_probe_start'),
    description: '创建一次隔离的 Work 文件传输探针。它只签发短期 raw HTTP PUT 上传票据并写入 data/work-media-probe，不接受 Base64 或伪造的 MCP 文件参数，也不会发布日报、排队邮件或发送 SMTP。Work 必须用实际可用的云端文件/网络能力把原始字节交给返回的 uploadUrlTemplate；如果只能提供 URL，则不能把它当作文件上传成功。X-Original-Filename 使用 URL 编码以兼容 HTTP 头，服务端会还原原始文件名。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '可选的 YYYY-MM-DD 关联日期；不触发日报生成或发布' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.media_probe_status',
    securitySchemes: oauthSecurity('daily_report.media_probe_status'),
    description: '读取当前账号拥有的隔离 Work 媒体探针结果，重新读取服务器文件并核对字节数、MIME 与 SHA-256；不会读取或修改正式日报媒体。',
    inputSchema: {
      type: 'object',
      required: ['probeId'],
      properties: {
        probeId: { type: 'string', description: 'media_probe_start 返回的 Probe ID' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.media_prepare_start',
    securitySchemes: oauthSecurity('daily_report.media_prepare_start'),
    description: '创建 Cloud 日报媒体准备批次。只记录当前 OAuth 账号、日期与 runId，不发布日报、不排队邮件、不发送 SMTP。随后用 media_prepare 提交每个 assetKey 的候选图片 URL。',
    inputSchema: {
      type: 'object',
      required: ['date'],
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.media_prepare',
    securitySchemes: oauthSecurity('daily_report.media_prepare'),
    description: '为一个媒体批次抓取并托管图片候选。服务器独立执行 redirect、SSRF、MIME、magic bytes、大小、SHA-256 与原子存储校验；同一 assetKey 按候选顺序回退，返回每次失败原因和最终 hostedUrl。不会发布日报或排队邮件。',
    inputSchema: {
      type: 'object',
      required: ['mediaBatchId', 'assets'],
      properties: {
        mediaBatchId: { type: 'string' },
        assets: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['assetKey', 'candidates'],
            properties: {
              assetKey: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' },
              candidates: {
                type: 'array',
                minItems: 1,
                maxItems: 5,
                items: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', maxLength: 4096 },
                    sourceUrl: { type: 'string', maxLength: 4096 },
                    sourceDomain: { type: 'string', maxLength: 253 },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'daily_report.media_prepare_status',
    securitySchemes: oauthSecurity('daily_report.media_prepare_status'),
    description: '读取当前账号的媒体准备批次和每个 assetKey 的托管、哈希与失败回退结果；不会触发重新抓取、发布或邮件。',
    inputSchema: {
      type: 'object',
      required: ['mediaBatchId'],
      properties: { mediaBatchId: { type: 'string' } },
      additionalProperties: false,
    },
  },
];

class DailyReportCloudMcpAuthError extends Error {
  constructor(readonly scopes: readonly DailyReportCloudScope[]) {
    super('当前连接没有该工具所需的 scope');
    this.name = 'DailyReportCloudMcpAuthError';
  }
}

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
  if (CLOUD_MARKDOWN_CREDENTIAL_PATTERN.test(markdown) || CLOUD_MARKDOWN_LOCAL_PATH_PATTERN.test(markdown)) {
    throw new Error('日报正文触发凭据或本地路径安全检查');
  }
}

function toolScopeAllowed(auth: OAuthBearerContext, toolName: string): boolean {
  return (TOOL_SCOPES[toolName] || []).every(scope => auth.scopes.includes(scope));
}

function cloudMediaBatchRequired(): boolean {
  return process.env.CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED === 'true';
}

async function callTool(auth: OAuthBearerContext, name: string, rawArguments: unknown): Promise<Record<string, unknown>> {
  if (!toolScopeAllowed(auth, name)) throw new DailyReportCloudMcpAuthError(TOOL_SCOPES[name] || []);
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
    const cloudContext = getDailyReportCloudContext(auth.userId);
    const requirements = getCloudDigestCompletenessRequirements({ mail, cloudContext: cloudContext.context });
    return {
      date,
      generatedAt: new Date().toISOString(),
      calendar: readCalendar(auth.userId, date),
      mail,
      cloudContext,
      requirements: summarizeCloudDigestCompletenessRequirements(requirements),
      activity: listDailyReportCloudActivity(auth.userId, { limit: 100 }),
      history: listDailyReportCloudHistory(auth.userId, 7),
    };
  }
  if (name === 'daily_report.media_probe_start') {
    if (!isWorkMediaProbeEnabled()) throw new Error('Work 文件传输探针当前未启用');
    const ticket = createWorkMediaProbe({
      userId: auth.userId,
      clientId: auth.clientId,
      date: stringValue(args.date) || undefined,
    });
    return {
      status: 'PROBE_CREATED',
      probeId: ticket.probeId,
      runId: ticket.runId,
      date: ticket.date,
      createdAt: ticket.createdAt,
      expiresAt: ticket.expiresAt,
      transport: ticket.transport,
      upload: {
        method: 'PUT',
        urlTemplate: `${dailyReportCloudIssuer()}${WORK_MEDIA_PROBE_ROUTE}/${ticket.probeId}/assets/{assetKey}`,
        uploadToken: ticket.uploadToken,
        requiredHeaders: ['Authorization: Bearer <uploadToken>', 'Content-Type', 'X-Original-Filename (URL-encode when non-ASCII)'],
        assetKeyPattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
      },
      limits: {
        mcpRequestMaxBytes: 1_000_000,
        maxBytesPerFile: ticket.maxBytesPerFile,
        maxFiles: ticket.maxFiles,
        maxTotalBytes: ticket.maxTotalBytes,
      },
      safety: {
        formalDailyReportMediaTouched: false,
        publishCalled: false,
        notificationQueued: false,
        smtpCalled: false,
      },
    };
  }
  if (name === 'daily_report.media_probe_status') {
    if (!isWorkMediaProbeEnabled()) throw new Error('Work 文件传输探针当前未启用');
    const probeId = stringValue(args.probeId);
    if (!probeId) throw new Error('probeId 不能为空');
    return getWorkMediaProbeStatus(probeId, auth.userId);
  }
  if (name === 'daily_report.media_prepare_start') {
    return createDailyReportMediaPrepareBatch(auth.userId, stringValue(args.date)) as unknown as Record<string, unknown>;
  }
  if (name === 'daily_report.media_prepare') {
    const mediaBatchId = stringValue(args.mediaBatchId);
    if (!mediaBatchId) throw new Error('mediaBatchId 不能为空');
    return await prepareDailyReportMedia(auth.userId, mediaBatchId, args.assets) as unknown as Record<string, unknown>;
  }
  if (name === 'daily_report.media_prepare_status') {
    const mediaBatchId = stringValue(args.mediaBatchId);
    if (!mediaBatchId) throw new Error('mediaBatchId 不能为空');
    return getDailyReportMediaPrepareStatus(auth.userId, mediaBatchId) as unknown as Record<string, unknown>;
  }
  if (name === 'daily_report.publish') {
    const date = stringValue(args.date);
    assertCloudMarkdown(date, args.markdown);
    // 先验证新闻数量、来源、分类角度、图片覆盖和头版候选，再进入媒体下载。
    const initialValidation = validateDailyDigestMarkdown(args.markdown);
    const [mail, cloudContext] = await Promise.all([
      readMail(auth.userId, 20),
      Promise.resolve(getDailyReportCloudContext(auth.userId)),
    ]);
    const requirements = getCloudDigestCompletenessRequirements({ mail, cloudContext: cloudContext.context });
    assertCloudDigestCompleteness(initialValidation.digest, requirements);

    const mediaBatchId = stringValue(args.mediaBatchId);
    if (cloudMediaBatchRequired() && !mediaBatchId) {
      throw new Error('Cloud 日报正式路径必须先准备 mediaBatchId');
    }
    if (mediaBatchId) {
      const batchCheck = assertDailyReportMediaBatchReadyForPublish(auth.userId, {
        mediaBatchId,
        runId: stringValue(args.runId),
        reportDate: date,
        requiredAssetKeys: args.requiredAssetKeys,
        markdown: args.markdown,
      });
      const validated = validateDailyDigestMarkdown(args.markdown, { requireHostedImages: true });
      const media = summarizeDailyReportMedia(args.markdown);
      if (args.dry_run === true) {
        return {
          status: 'VALIDATED_NOT_PUBLISHED',
          date,
          source: 'cloud',
          mediaBatchId: batchCheck.batch.id,
          runId: batchCheck.batch.run_id,
          mediaBatchStatus: batchCheck.batch.status,
          mediaCount: media.mediaCount,
          imageCount: media.imageCount,
          logoCount: media.logoCount,
          featuredHeadline: validated.quality.featured.headline,
          featuredImageUrl: validated.quality.featured.imageUrl,
        };
      }
      try {
        const result = await publishDailyReport(auth.userId, date, args.markdown, { requireHostedMedia: true, source: 'cloud' });
        const committed = commitDailyReportMediaBatch(auth.userId, mediaBatchId);
        return {
          status: 'PUBLISHED',
          date,
          source: 'cloud',
          mediaBatchId,
          runId: batchCheck.batch.run_id,
          mediaBatchStatus: committed.status,
          deliveryStatus: result.report.deliveryStatus,
          reportStatus: result.reportStatus,
          emailStatus: result.emailStatus,
          contentHash: result.report.contentHash,
          mediaCount: media.mediaCount,
          imageCount: media.imageCount,
          logoCount: media.logoCount,
          featuredHeadline: validated.quality.featured.headline,
          featuredImageUrl: validated.quality.featured.imageUrl,
          report: {
            headline: result.report.headline,
            excerpt: result.report.excerpt,
            publishedAt: result.report.publishedAt,
            updatedAt: result.report.updatedAt,
            source: result.report.source,
            deliveryStatus: result.report.deliveryStatus,
          },
        };
      } catch (error) {
        try { markDailyReportMediaBatchPendingRetry(auth.userId, mediaBatchId, error instanceof Error ? error.message : '日报发布失败'); } catch {}
        throw error;
      }
    }

    // dry-run 也在服务端完成媒体下载、签名校验和哈希缓存，保证正式调用不会才发现云端无法托管图片/logo。
    const localizedMarkdown = await localizeDailyDigestImages(args.markdown, {
      requireHostedMedia: false,
      requireAllMedia: true,
      // Cloud 只托管调用方明确提供的媒体；自动推断的可选图标不应成为发布的外部依赖。
      inferSourceLogos: false,
    });
    assertHostedDailyReportMedia(localizedMarkdown);
    const validated = validateDailyDigestMarkdown(localizedMarkdown, { requireHostedImages: true });
    const media = summarizeDailyReportMedia(localizedMarkdown);
    if (args.dry_run === true) {
      return {
        status: 'VALIDATED_NOT_PUBLISHED',
        date,
        source: 'cloud',
        mediaCount: media.mediaCount,
        imageCount: media.imageCount,
        logoCount: media.logoCount,
        featuredHeadline: validated.quality.featured.headline,
        featuredImageUrl: validated.quality.featured.imageUrl,
      };
    }
    const result = await publishDailyReport(auth.userId, date, localizedMarkdown, { requireHostedMedia: true, source: 'cloud' });
    return {
      status: 'PUBLISHED',
      date,
      source: 'cloud',
      deliveryStatus: result.report.deliveryStatus,
      reportStatus: result.reportStatus,
      emailStatus: result.emailStatus,
      contentHash: result.report.contentHash,
      mediaCount: media.mediaCount,
      imageCount: media.imageCount,
      logoCount: media.logoCount,
      featuredHeadline: validated.quality.featured.headline,
      featuredImageUrl: validated.quality.featured.imageUrl,
      report: {
        headline: result.report.headline,
        excerpt: result.report.excerpt,
        publishedAt: result.report.publishedAt,
        updatedAt: result.report.updatedAt,
        source: result.report.source,
        deliveryStatus: result.report.deliveryStatus,
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
  res.setHeader('WWW-Authenticate', mcpWwwAuthenticate());
  res.status(401).json({ error: 'OAuth access token 无效、已过期或 scope 不足' });
  return null;
}

function mcpWwwAuthenticate(
  scopes: readonly DailyReportCloudScope[] = [],
  error?: string,
  errorDescription?: string,
): string {
  const values = [
    'Bearer realm="daily-report"',
    `resource_metadata="${dailyReportCloudIssuer()}/.well-known/oauth-protected-resource/mcp"`,
  ];
  if (scopes.length) values.push(`scope="${scopes.join(' ')}"`);
  if (error) values.push(`error="${error}"`);
  if (errorDescription) values.push(`error_description="${errorDescription.replaceAll('"', '\\"')}"`);
  return values.join(', ');
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
          ...(error instanceof DailyReportCloudMcpAuthError
            ? {
                _meta: {
                  'mcp/www_authenticate': [
                    mcpWwwAuthenticate(error.scopes, 'insufficient_scope', '需要重新授权以获得该工具权限'),
                  ],
                },
              }
            : {}),
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

export { toolDefinitions, callTool, handleJsonRpc };
