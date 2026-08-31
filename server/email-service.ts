/**
 * 邮件服务 - nodemailer 封装
 * 支持发送验证码邮件和每日提醒邮件
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import type { ReminderCycle, ReminderTask, SimConfig, CreditCardConfig, GenericReminderConfig } from './reminder-store.js';
import * as db from './db.js';
import { getSchedulesByDate } from './schedule-store.js';
import { renderDailyReminderEmail } from './daily-email-template.js';
import { renderDailyDigestEmailPage, renderDailyDigestPlainText } from './daily-digest-template.js';
import { getDailyWeather } from './weather-service.js';
import { addLog } from './log-service.js';
import { escapeHtml, renderMarkdown } from './markdown-renderer.js';

const OFFICIAL_SENDER_EMAIL = 'aicalendarofficial@163.com';

dotenv.config();

const SMTP_HOST = (process.env.SMTP_HOST || 'smtp.163.com').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = (process.env.SMTP_USER || OFFICIAL_SENDER_EMAIL).trim();

export function getEmailConfigurationSummary(): Record<string, unknown> {
  return {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    user: SMTP_USER,
    passwordConfigured: Boolean(process.env.SMTP_PASS?.trim()),
    hostMatchesOfficial: SMTP_HOST.toLowerCase() === 'smtp.163.com',
    userMatchesOfficial: SMTP_USER.toLowerCase() === OFFICIAL_SENDER_EMAIL,
    portValid: Number.isInteger(SMTP_PORT) && SMTP_PORT > 0,
  };
}

// 创建 transporter
let transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  requireTLS: SMTP_PORT !== 465,
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
  auth: {
    user: SMTP_USER,
    pass: process.env.SMTP_PASS || '',
  },
});

/** 仅供隔离测试替换 SMTP 传输，不改变生产配置和发件人约束。 */
export function setEmailTransportForTests(next: { sendMail: (options: Record<string, unknown>) => Promise<unknown> }): void {
  transporter = next as typeof transporter;
}

export interface EmailSendResult {
  accepted: string[];
  rejected: string[];
  pending: string[];
  response: string | null;
  messageId: string | null;
  envelope: {
    from: string | null;
    to: string[];
  } | null;
}

function addressList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value)];
}

/**
 * 将 Nodemailer 的返回对象压缩为可记录、可测试的 SMTP 结果。
 * 不把原始对象直接写入日志，避免把连接内部字段或邮件正文带入日志。
 */
export function normalizeEmailSendResult(info: unknown): EmailSendResult {
  const value = info && typeof info === 'object' ? info as Record<string, unknown> : {};
  const rawEnvelope = value.envelope && typeof value.envelope === 'object'
    ? value.envelope as Record<string, unknown>
    : null;
  return {
    accepted: addressList(value.accepted),
    rejected: addressList(value.rejected),
    pending: addressList(value.pending),
    response: value.response == null ? null : String(value.response),
    messageId: value.messageId == null ? null : String(value.messageId),
    envelope: rawEnvelope ? {
      from: rawEnvelope.from == null ? null : String(rawEnvelope.from),
      to: addressList(rawEnvelope.to),
    } : null,
  };
}

/**
 * SMTP 连接成功不等于目标收件人被接受。单收件人邮件若没有 accepted，必须进入失败重试，
 * 不能仅凭 sendMail() 没抛异常就标记为 sent。
 */
export function assertEmailSendResult(info: unknown): EmailSendResult {
  const result = normalizeEmailSendResult(info);
  if (result.accepted.length === 0 || result.rejected.length > 0 || result.pending.length > 0) {
    const error = new Error(
      `SMTP 未接受邮件：accepted=${result.accepted.length}, rejected=${result.rejected.length}, pending=${result.pending.length}`,
    ) as Error & { code?: string; emailResult?: EmailSendResult };
    error.code = 'EENVELOPE';
    error.emailResult = result;
    throw error;
  }
  return result;
}

export function summarizeEmailSendResult(result: EmailSendResult): Record<string, unknown> {
  return {
    messageId: result.messageId,
    response: result.response,
    acceptedCount: result.accepted.length,
    rejectedCount: result.rejected.length,
    pendingCount: result.pending.length,
    envelopeToCount: result.envelope?.to.length ?? 0,
  };
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || !error || !('code' in error)) return null;
  const code = String((error as { code?: unknown }).code || '').trim();
  return code || null;
}

function getEmailResultFromError(error: unknown): EmailSendResult | null {
  if (typeof error !== 'object' || !error || !('emailResult' in error)) return null;
  const result = (error as { emailResult?: unknown }).emailResult;
  return result && typeof result === 'object' ? result as EmailSendResult : null;
}

export function formatDateTimeInTimezone(
  date = new Date(),
  timezone = process.env.APP_TIMEZONE || 'Asia/Shanghai',
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second} ${value.timeZoneName}`;
}

function dateInTimezone(date = new Date(), timezone = process.env.APP_TIMEZONE || 'Asia/Shanghai'): string {
  return formatDateTimeInTimezone(date, timezone).slice(0, 10);
}

function emailConfigurationError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = 'EMAIL_CONFIG';
  return error;
}

function assertEmailConfiguration(to: string): void {
  if (!to.trim()) {
    throw emailConfigurationError('没有可用的收件邮箱，请先在右上角“设置”中配置提醒邮箱');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    throw emailConfigurationError('收件邮箱格式不正确，请在“设置”中检查提醒邮箱');
  }
  if (SMTP_HOST.toLowerCase() !== 'smtp.163.com') {
    throw emailConfigurationError('邮件服务配置不一致：SMTP_HOST 必须设置为 smtp.163.com');
  }
  if (SMTP_USER.toLowerCase() !== OFFICIAL_SENDER_EMAIL) {
    throw emailConfigurationError(`邮件服务配置不一致：SMTP_USER 必须设置为 ${OFFICIAL_SENDER_EMAIL}`);
  }
  if (!Number.isInteger(SMTP_PORT) || SMTP_PORT <= 0) {
    throw emailConfigurationError('邮件服务配置错误：SMTP_PORT 必须是有效端口，推荐使用 465');
  }
  if (!process.env.SMTP_PASS?.trim()) {
    throw emailConfigurationError('邮件服务尚未配置：请在 .env 的 SMTP_PASS 中填写 163 邮箱客户端授权码');
  }
}

async function sendEmail(message: {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  mailType: string;
}): Promise<EmailSendResult> {
  const { mailType, ...mailOptions } = message;
  const startedAt = Date.now();
  addLog('debug', 'mail', '邮件传输开始', {
    event: 'mail_send_started',
    mailType,
    recipient: message.to,
    subjectLength: message.subject.length,
    hasHtml: Boolean(message.html),
    hasText: Boolean(message.text),
  });
  try {
    assertEmailConfiguration(message.to);
    const info = await transporter.sendMail(mailOptions);
    const result = normalizeEmailSendResult(info);
    addLog(
      result.accepted.length > 0 && result.rejected.length === 0 && result.pending.length === 0 ? 'info' : 'warn',
      'mail',
      'SMTP 已返回邮件反馈',
      {
        event: 'mail_smtp_feedback',
        mailType,
        recipient: message.to,
        durationMs: Date.now() - startedAt,
        ...summarizeEmailSendResult(result),
      },
    );
    return assertEmailSendResult(result);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const code = getErrorCode(error);

    let mappedError = error;

    if (code === 'EAUTH') {
      const mapped = new Error('163 邮箱认证失败：请确认已开启 SMTP 服务，并且 SMTP_PASS 填写的是客户端授权码而不是网页登录密码') as Error & { code?: string };
      mapped.code = code;
      mappedError = mapped;
    }
    if (mappedError === error && (['ECONNECTION', 'ECONNRESET', 'ESOCKET', 'ETIMEDOUT'].includes(code || '') || /TLS|socket/i.test(details))) {
      const mapped = new Error(`无法与 163 邮箱建立安全连接，请检查 SMTP_HOST、SMTP_PORT 和服务器出站网络。原始错误：${details}`) as Error & { code?: string };
      mapped.code = code || 'ESMTP_CONNECTION';
      mappedError = mapped;
    }
    const mappedCode = getErrorCode(mappedError);
    const emailResult = getEmailResultFromError(mappedError) || getEmailResultFromError(error);
    addLog('error', 'mail', '邮件传输失败', {
      event: 'mail_send_failed',
      mailType,
      recipient: message.to,
      durationMs: Date.now() - startedAt,
      error: mappedError instanceof Error ? mappedError.message : details,
      ...(mappedCode ? { errorCode: mappedCode } : {}),
      ...(emailResult ? summarizeEmailSendResult(emailResult) : {}),
    });
    throw mappedError;
  }
}

// 生成6位验证码
export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 发送验证码邮件
export async function sendVerificationEmail(to: string, code: string, purpose: 'register' | 'reset_password'): Promise<EmailSendResult> {
  const subject = purpose === 'register' ? '【AI Calendar】注册验证码' : '【AI Calendar】重置密码验证码';
  const html = purpose === 'register' ? `
    <div style="font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background: #f9fafb; border-radius: 12px;">
      <div style="background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 24px; text-align: center;">📅 AI Calendar</h2>
        <div style="background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; text-align: center; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">您的验证码是</div>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; font-family: monospace;">${code}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">有效期10分钟，请勿泄露</div>
        </div>
        <p style="color: #6b7280; font-size: 14px; text-align: center;">如果您没有发起此请求，请忽略此邮件。</p>
      </div>
    </div>
  ` : `
    <div style="font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background: #f9fafb; border-radius: 12px;">
      <div style="background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 24px; text-align: center;">📅 AI Calendar</h2>
        <div style="background: linear-gradient(135deg, #ef4444, #f97316); color: #fff; text-align: center; padding: 24px; border-radius: 8px; margin-bottom: 24px;">
          <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">您的验证码是</div>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; font-family: monospace;">${code}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 8px;">有效期10分钟，请勿泄露</div>
        </div>
        <p style="color: #6b7280; font-size: 14px; text-align: center;">如果您没有发起此请求，请忽略此邮件。</p>
      </div>
    </div>
  `;

  return sendEmail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject,
    html,
    mailType: purpose === 'register' ? 'register_verification' : 'password_reset_verification',
  });
}

// 发送每日提醒邮件
export async function sendDailyReminderEmail(to: string, userId: string, dateOverride?: string): Promise<EmailSendResult> {
  const preference = db.getReminder(userId);
  const timezone = preference?.timezone || 'Asia/Shanghai';
  const dateStr = dateOverride || dateInTimezone(new Date(), timezone);
  const schedules = getSchedulesByDate(dateStr, userId);
  let weather = null;
  let weatherError: string | null = null;
  if (preference?.home_latitude != null && preference.home_longitude != null) {
    try {
      weather = await getDailyWeather({
        latitude: Number(preference.home_latitude),
        longitude: Number(preference.home_longitude),
        timezone: preference.home_timezone || timezone,
      }, dateStr);
    } catch (error) {
      weatherError = error instanceof Error ? error.message : '天气服务暂不可用';
    }
  }
  const rendered = renderDailyReminderEmail({
    date: dateStr,
    hour: preference?.hour ?? 8,
    schedules,
    appUrl: process.env.APP_URL || 'http://localhost:3000/today',
    locationName: preference?.home_location_name || null,
    weather,
    weatherError,
  });

  return sendEmail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject: rendered.subject,
    html: rendered.html,
    mailType: 'daily_digest',
  });
}

function reportAppUrl(date: string): string {
  const fallback = 'http://localhost:3000';
  const configured = (process.env.APP_URL || fallback).trim().replace(/\/+$/, '');
  try {
    const base = new URL(configured);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('unsupported app url');
    return `${base.origin}/reports/${encodeURIComponent(date)}`;
  } catch {
    return `${fallback}/reports/${encodeURIComponent(date)}`;
  }
}

/** 发送日报邮件。正文与网站共用受限 Markdown 渲染器，原始 HTML 不会执行。 */
export async function sendDailyReportEmail(to: string, date: string, markdown: string): Promise<EmailSendResult> {
  const subject = `个人情报日报 · ${date}`;
  const url = reportAppUrl(date);
  const html = renderDailyDigestEmailPage(markdown, url) || `
    <div style="font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 920px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h1 style="font-size: 24px; margin: 0 0 20px;">${escapeHtml(subject)}</h1>
      <article class="daily-report-markdown" style="line-height: 1.75;">${renderMarkdown(markdown)}</article>
      <p style="margin-top: 28px; font-size: 13px;"><a href="${escapeHtml(url)}">在 AI Calendar 中查看私有日报页面</a></p>
    </div>
  `;
  const text = renderDailyDigestPlainText(markdown, url) || `${subject}\n\n${markdown}\n\n在 AI Calendar 中查看私有日报页面：${url}`;
  return sendEmail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject,
    html,
    text,
    mailType: 'daily_report',
  });
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export async function sendCycleReminderEmail(input: {
  to: string;
  task: ReminderTask;
  cycle: ReminderCycle;
  reminderType: string;
  scheduledDate: string;
}): Promise<EmailSendResult> {
  const { task, cycle, reminderType, scheduledDate } = input;
  const to = input.to;
  const appUrl = process.env.APP_URL || 'http://localhost:3000/schedule';
  const today = dateInTimezone();
  const delayed = scheduledDate < today;
  const safeName = escapeHtml(task.name);
  const safeDueDate = escapeHtml(cycle.dueDate);
  const remainingDays = daysBetween(today, cycle.dueDate);

  let subject: string;
  let body: string;
  if (task.type === 'credit_card') {
    const config = task.config as CreditCardConfig;
    const paymentText = reminderType === 'statement_issued'
      ? '本期账单已按规则进入提醒周期。'
      : `距离还款日还有 ${Math.max(remainingDays, 0)} 天。`;
    subject = reminderType === 'statement_issued'
      ? `【信用卡提醒】${task.name} 本期账单已出账`
      : `【还款提醒】${task.name} 距离还款日还有 ${Math.max(remainingDays, 0)} 天`;
    body = `
      <p>${paymentText}</p>
      <p>账单日：${escapeHtml(cycle.periodStart)}<br>
      最晚还款日：${safeDueDate}<br>
      还款规则：每月 ${config.paymentDay} 日（${config.paymentMonthOffset === 1 ? '次月' : '当月'}）</p>
    `;
  } else if (task.type === 'sim') {
    const config = task.config as SimConfig;
    subject = `【SIM 卡提醒】${task.name} 距离保号截止还有 ${Math.max(remainingDays, 0)} 天`;
    body = `
      <p>${safeName} 即将到达本次保号检查日期。</p>
      <p>运营商：${escapeHtml(config.provider)}<br>
      号码：${escapeHtml(config.numberMasked)}<br>
      上次有效操作：${escapeHtml(config.lastOperationDate)}<br>
      本次截止日期：${safeDueDate}</p>
      <p>建议操作：${escapeHtml(config.actionGuide)}</p>
    `;
  } else {
    const config = task.config as GenericReminderConfig;
    subject = `【事务提醒】${task.name} · ${safeDueDate} 到期`;
    body = `
      <p>${safeName} 即将到期，请按计划处理。</p>
      <p>到期日期：${safeDueDate}<br>
      事务类型：${escapeHtml(config.templateKey)}<br>
      建议操作：${escapeHtml(config.actionGuide || '完成本周期事务并登记')}</p>
    `;
  }

  return sendEmail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject,
    html: `
      <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f4f7fb;color:#182230">
        <div style="background:#fff;border:1px solid #e5eaf1;border-radius:18px;padding:28px">
          <div style="font-size:13px;color:#6b7280;margin-bottom:10px">AI Calendar · 周期提醒</div>
          <h2 style="margin:0 0 18px;color:#14213d">${safeName}</h2>
          ${body}
          ${delayed ? '<p style="color:#b45309;background:#fff7ed;padding:10px;border-radius:8px">本提醒因服务中断而延迟发送。</p>' : ''}
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:12px;background:#2563eb;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none">打开日历并标记完成</a>
          <p style="font-size:12px;color:#94a3b8;margin-top:22px">周期编号：${escapeHtml(cycle.id)}</p>
        </div>
      </div>
    `,
    mailType: 'cycle_reminder',
  });
}

export async function sendQueuedNotificationEmail(to: string, title: string, body: string): Promise<EmailSendResult> {
  const appUrl = process.env.APP_URL || 'http://localhost:3000/today';
  return sendEmail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject: title,
    html: `
      <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f4f7fb;color:#182230">
        <div style="background:#fff;border:1px solid #e5eaf1;border-radius:18px;padding:28px">
          <div style="font-size:13px;color:#6b7280;margin-bottom:10px">AI Calendar · 行动提醒</div>
          <h2 style="margin:0 0 16px;color:#14213d">${escapeHtml(title)}</h2>
          <p style="line-height:1.7">${escapeHtml(body).replace(/\n/g, '<br>')}</p>
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:12px;background:#2563eb;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none">打开今日行动中心</a>
        </div>
      </div>
    `,
    mailType: 'queued_notification',
  });
}

export async function sendReminderTestEmail(to: string): Promise<EmailSendResult> {
  return sendEmail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject: '【测试成功】周期提醒系统邮件发送正常',
    text: [
      '周期提醒系统邮件发送正常。',
      `测试时间：${formatDateTimeInTimezone()}`,
      `服务器时区：${process.env.APP_TIMEZONE || 'Asia/Shanghai'}`,
      `发件地址：${OFFICIAL_SENDER_EMAIL || '(未配置)'}`,
      `收件地址：${to}`,
      '服务版本：smart-schedule-agent',
    ].join('\n'),
    mailType: 'reminder_test',
  });
}
