import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { isValidDateKey } from '../date-key.js';
import { describeErrorData } from '../runtime/logging.js';
import express from 'express';

import * as scheduleStore from '../schedule-store.js';
import { authenticateDailyReportToken } from '../daily-report-token-service.js';
import { publishDailyReport, queueDailyReportEmail } from '../daily-report-service.js';
import { DAILY_REPORT_MEDIA_MAX_BYTES, DAILY_REPORT_MEDIA_UPLOAD_ROUTE, dailyReportMediaRoot, storeProvidedDailyReportMedia, summarizeDailyReportMedia } from '../daily-report-media-service.js';
import { WORK_MEDIA_PROBE_MAX_BYTES, WORK_MEDIA_PROBE_ROUTE, isWorkMediaProbeEnabled, uploadWorkMediaProbeAsset } from '../work-media-probe-service.js';
import { readUserMail } from '../user-mail-service.js';
import { addLog } from '../log-service.js';
import * as db from '../db.js';

export function createReportsPublishRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.post('/api/daily-reports/:date/send', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const userId = (req as any).user.userId;
    const date = String(req.params.date || '');
    if (!isValidDateKey(date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD 日期' });
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: '请确认要重新发送这一天的日报邮件' });
    }
    const rawSource = req.body?.source;
    if (rawSource !== undefined && rawSource !== 'local' && rawSource !== 'cloud') {
      return res.status(400).json({ error: 'source 只能是 local 或 cloud' });
    }
    try {
      const report = queueDailyReportEmail(userId, date, { manual: true, source: rawSource });
      if (!report) return res.status(404).json({ error: '该日期的日报不存在' });
      addLog('info', 'mail', '日报邮件已请求手动重发', {
        event: 'daily_report_manual_send_requested',
        userId,
        date,
        notificationId: report.emailNotificationId,
      });
      res.status(202).json({
        date,
        emailStatus: report.emailStatus,
        notificationId: report.emailNotificationId,
      });
    } catch (error: any) {
      addLog('error', 'mail', '日报邮件手动重发入队失败', describeErrorData(error, {
        event: 'daily_report_manual_send_failed',
        userId,
        date,
      }));
      res.status(503).json({ error: '日报邮件暂时无法排队，请稍后重试' });
    }
  });

  function dateKeyInTimezone(value: string, timezone: string, allDay: boolean): string {
    if (allDay || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 10);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(0, 10);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const find = (type: string) => parts.find(part => part.type === type)?.value || '';
    return `${find('year')}-${find('month')}-${find('day')}`;
  }

  app.get('/api/integrations/daily-report/agenda', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = String(req.header('authorization') || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const authenticated = match ? authenticateDailyReportToken(match[1].trim()) : null;
    if (!authenticated) return res.status(401).json({ error: '日报令牌无效或已经撤销' });
    const date = String(req.query.date || '');
    if (!isValidDateKey(date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD 日期' });
    const preference = db.getReminder(authenticated.userId);
    const timezone = preference?.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai';
    const schedules = scheduleStore.getAllSchedules(authenticated.userId)
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
    res.json({ date, timezone, generatedAt: new Date().toISOString(), schedules });
  });

  // 独立日报项目使用同一只读令牌读取当前账号的 QQ 未读邮件摘要；不会返回邮箱授权码。
  app.get('/api/integrations/daily-report/mail', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = String(req.header('authorization') || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const authenticated = match ? authenticateDailyReportToken(match[1].trim()) : null;
    if (!authenticated) return res.status(401).json({ error: '日报令牌无效或已经撤销' });
    const parsedLimit = Number(req.query.limit || 20);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({ error: 'limit 必须是 1 到 100 之间的整数' });
    }
    const result = await readUserMail(authenticated.userId, parsedLimit);
    res.json({ ...result, generatedAt: new Date().toISOString() });
  });

  const dailyReportMediaRawBody = express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml', 'application/octet-stream'],
    limit: `${DAILY_REPORT_MEDIA_MAX_BYTES}b`,
  });

  const workMediaProbeRawBody = express.raw({
    type: () => true,
    limit: `${WORK_MEDIA_PROBE_MAX_BYTES}b`,
  });

  // Work 文件能力验证的隔离接收端：只接受短期 Probe 票据和原始字节，绝不写入正式日报媒体目录。
  app.put(`${WORK_MEDIA_PROBE_ROUTE}/:probeId/assets/:assetKey`, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isWorkMediaProbeEnabled()) return res.status(404).json({ error: 'Work 文件传输探针未启用' });
    workMediaProbeRawBody(req, res, error => {
      if (error) {
        const tooLarge = (error as { type?: string }).type === 'entity.too.large';
        return res.status(tooLarge ? 413 : 400).json({
          error: tooLarge ? 'Probe 单文件超过 5 MiB 限制' : 'Probe 请求正文无法作为原始文件读取',
        });
      }
      next();
    });
  }, (req, res) => {
    const authorization = String(req.header('authorization') || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    try {
      const asset = uploadWorkMediaProbeAsset({
        probeId: String(req.params.probeId || ''),
        uploadToken: match?.[1]?.trim() || '',
        assetKey: String(req.params.assetKey || ''),
        originalFilename: (() => {
          const raw = String(req.header('x-original-filename') || '');
          if (!raw) return '';
          try {
            return decodeURIComponent(raw);
          } catch {
            return raw;
          }
        })(),
        declaredMime: String(req.header('content-type') || ''),
        buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      });
      res.status(200).json({
        status: 'RECEIVED',
        probeId: String(req.params.probeId || ''),
        ...asset,
      });
    } catch (error) {
      const statusCode = error && typeof error === 'object' && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode) || 400
        : 400;
      const message = error instanceof Error ? error.message : 'Probe 文件上传失败';
      res.status(statusCode).json({ error: message });
    }
  });

  // 独立日报项目先使用只读令牌上传本地校验过的媒体，再发布只引用本站媒体的 Markdown。
  app.put(`${DAILY_REPORT_MEDIA_UPLOAD_ROUTE}/:date/media/:filename`, (req, res, next) => {
    const authorization = String(req.header('authorization') || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const authenticated = match ? authenticateDailyReportToken(match[1].trim()) : null;
    if (!authenticated) return res.status(401).json({ error: '日报令牌无效或已经撤销' });
    const date = String(req.params.date || '');
    if (!isValidDateKey(date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD 日期' });
    (req as any).dailyReportMediaUserId = authenticated.userId;
    next();
  }, dailyReportMediaRawBody, (req, res) => {
    const date = String(req.params.date || '');
    const filename = String(req.params.filename || '');
    try {
      const stored = storeProvidedDailyReportMedia(
        filename,
        Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        String(req.header('content-type') || ''),
        dailyReportMediaRoot(),
      );
      res.status(200).json({
        status: 'READY',
        date,
        filename: stored.filename,
        sha256: stored.sha256,
        sizeBytes: stored.sizeBytes,
      });
    } catch (error: any) {
      const message = String(error?.message || '日报媒体上传失败');
      res.status(400).json({ error: message });
    }
  });

  // 独立日报项目使用只读令牌发布已通过 Validator 的 Markdown；不会接收账号或邮箱字段。
  app.put('/api/integrations/daily-report/reports/:date', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = String(req.header('authorization') || '');
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const authenticated = match ? authenticateDailyReportToken(match[1].trim()) : null;
    if (!authenticated) return res.status(401).json({ error: '日报令牌无效或已经撤销' });
    const date = String(req.params.date || '');
    if (!isValidDateKey(date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD 日期' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== 'markdown')) {
      return res.status(400).json({ error: '请求正文只允许包含 markdown 字段' });
    }
    try {
      const result = await publishDailyReport(authenticated.userId, date, req.body.markdown, { requireHostedMedia: true, source: 'local' });
      const media = summarizeDailyReportMedia(result.report.markdown || req.body.markdown);
      res.status(result.reportStatus === 'CREATED' ? 201 : 200).json({
        status: result.status,
        date,
        source: result.report.source,
        deliveryStatus: result.report.deliveryStatus,
        reportStatus: result.reportStatus,
        emailStatus: result.emailStatus,
        contentHash: result.report.contentHash,
        mediaCount: media.mediaCount,
        imageCount: media.imageCount,
        logoCount: media.logoCount,
      });
    } catch (error: any) {
      const message = String(error?.message || '日报发布失败');
      addLog('error', 'daily-report', '日报发布失败', describeErrorData(error, {
        event: 'daily_report_publish_failed',
        userId: authenticated.userId,
        date,
      }));
      const badInput = /日报正文|日报媒体|图片|来源图标|date 必须|请求正文/.test(message);
      res.status(badInput ? 400 : 503).json({
        error: badInput ? message : '日报发布暂时不可用，请保留本地日报后稍后重试',
      });
    }
  });

  // ============= 用户备份与管理员灾备 =============
  return app;
}
