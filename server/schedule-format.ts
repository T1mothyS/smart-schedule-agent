/**
 * 日程格式化工具 - 用于生成 AI 风格的日程列表文本
 */

import type { Schedule } from './schedule-store.js';

const CATEGORY_LABELS: Record<string, string> = {
  travel: '出行', life: '生活', work: '工作',
  social: '社交', health: '健康', other: '其他'
};

const CATEGORY_ICONS: Record<string, string> = {
  work: '💼', life: '🏠', travel: '🚗',
  social: '👥', health: '❤️', other: '📌'
};

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatScheduleList(schedules: Schedule[], date: Date): string {
  if (schedules.length === 0) {
    return '今天暂无安排，好好休息吧 😊';
  }

  const dayOfWeek = WEEKDAY[date.getDay()];
  const dateStr = `${(date.getMonth() + 1).toString().padStart(2, '0')}月${date.getDate().toString().padStart(2, '0')}日${dayOfWeek}`;

  const completed = schedules.filter(s => s.is_completed);
  const pending = schedules.filter(s => !s.is_completed);
  const highRisk = pending.filter(s => s.is_high_risk);

  const lines: string[] = [];
  lines.push(`今天（${dateStr}）共有 ${schedules.length} 项安排，以下是详情：\n`);

  if (completed.length > 0) {
    lines.push(`✅ **已完成**\n`);
    completed.forEach((s, i) => {
      lines.push(`${i + 1}. ${formatItem(s)}\n`);
    });
    lines.push('');
  }

  if (pending.length > 0) {
    lines.push(`⏳ **进行中 / 待办**\n`);
    pending.forEach((s, i) => {
      lines.push(`${completed.length + i + 1}. ${formatItem(s)}\n`);
    });
    lines.push('');
  }

  // 总结
  const highCount = highRisk.length;
  if (highCount > 0) {
    const tips = pending
      .filter(s => s.is_high_risk || s.priority === 'high')
      .map(s => s.title)
      .join('、');
    lines.push(`⚠️ 注意：${tips} 都是高优先级事项，请提前做好准备！`);
  }

  return lines.join('\n');
}

function formatItem(s: Schedule): string {
  const icon = CATEGORY_ICONS[s.category] || '📌';
  const parts: string[] = [];

  parts.push(`${icon} ${s.title}`);

  if (s.all_day) {
    parts.push('全天');
  } else if (s.start_time) {
    const start = s.start_time.slice(11, 16);
    const end = s.end_time ? s.end_time.slice(11, 16) : '';
    parts.push(end ? `${start}~${end}` : start);
  }

  if (s.location) {
    parts.push(`📍 ${s.location}`);
  }

  if (s.is_high_risk) {
    parts.push('🚨 高危');
  } else if (s.priority === 'high') {
    parts.push('⚠️ 高优先级');
  }

  if (s.notes) {
    parts.push(`💡 ${s.notes}`);
  }

  return parts.join(' — ');
}
