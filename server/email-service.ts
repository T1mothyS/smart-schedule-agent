/**
 * 邮件服务 - nodemailer 封装
 * 支持发送验证码邮件和每日提醒邮件
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import type { ReminderCycle, ReminderTask, SimConfig, CreditCardConfig, GenericReminderConfig } from './reminder-store.js';

const OFFICIAL_SENDER_EMAIL = 'aicalendarofficial@163.com';

dotenv.config();

// 创建 transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.163.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true, // 使用 SSL
  auth: {
    user: OFFICIAL_SENDER_EMAIL,
    pass: process.env.SMTP_PASS || '',
  },
});

// 生成6位验证码
export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 发送验证码邮件
export async function sendVerificationEmail(to: string, code: string, purpose: 'register' | 'reset_password'): Promise<void> {
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

  await transporter.sendMail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject,
    html,
  });
}

// 发送每日提醒邮件
export async function sendDailyReminderEmail(to: string, userId: string): Promise<void> {
  // 动态导入避免循环依赖
  const { getSchedulesByDate } = await import('./schedule-store.js');
  const { formatScheduleList } = await import('./schedule-format.js');

  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const schedules = getSchedulesByDate(dateStr, userId);
  const content = formatScheduleList(schedules, today);

  const html = `
    <div style="font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f0f4ff; min-height: 100vh;">
      <div style="background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <h2 style="color: #1a1a1a; font-size: 22px; margin-bottom: 8px;">📅 ${today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} 日程提醒</h2>
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 24px;">来自 AI Calendar 的每日提醒</p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; line-height: 2; color: #374151; font-size: 15px; white-space: pre-line;">${content.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</div>
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
          <a href="${process.env.APP_URL || 'http://47.95.114.137:3000/schedule'}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #6366f1); color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 500;">打开 AI Calendar</a>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject: `📅 ${today.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} 您有 ${schedules.length} 项日程待处理`,
    html,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export async function sendCycleReminderEmail(input: {
  to?: string;
  task: ReminderTask;
  cycle: ReminderCycle;
  reminderType: string;
  scheduledDate: string;
}): Promise<void> {
  const { task, cycle, reminderType, scheduledDate } = input;
  const to = input.to || process.env.REMINDER_RECIPIENT_EMAIL || '905080737@qq.com';
  const appUrl = process.env.APP_URL || 'http://localhost:3000/schedule';
  const today = new Date().toISOString().slice(0, 10);
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
      ${config.amountCents ? `参考金额：${escapeHtml((config.amountCents / 100).toFixed(2))} ${escapeHtml(config.currency || 'CNY')}<br>` : ''}
      建议操作：${escapeHtml(config.actionGuide || '完成本周期事务并登记')}</p>
    `;
  }

  await transporter.sendMail({
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
  });
}

export async function sendQueuedNotificationEmail(to: string, title: string, body: string): Promise<void> {
  const appUrl = process.env.APP_URL || 'http://localhost:3000/today';
  await transporter.sendMail({
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
  });
}

export async function sendReminderTestEmail(to = process.env.REMINDER_RECIPIENT_EMAIL || '905080737@qq.com'): Promise<void> {
  await transporter.sendMail({
    from: `"AI Calendar" <${OFFICIAL_SENDER_EMAIL}>`,
    to,
    subject: '【测试成功】周期提醒系统邮件发送正常',
    text: [
      '周期提醒系统邮件发送正常。',
      `测试时间：${new Date().toISOString()}`,
      `服务器时区：${process.env.APP_TIMEZONE || 'Asia/Shanghai'}`,
      `发件地址：${OFFICIAL_SENDER_EMAIL || '(未配置)'}`,
      `收件地址：${to}`,
      '服务版本：smart-schedule-agent',
    ].join('\n'),
  });
}
