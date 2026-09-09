import type { Schedule } from './schedule-store.js';
import type { DailyWeather } from './weather-service.js';
import type { ActionItem } from './action-center.js';

const CATEGORY_META: Record<string, { label: string; color: string; background: string }> = {
  work: { label: '工作', color: '#2563eb', background: '#eff6ff' },
  life: { label: '生活', color: '#16a34a', background: '#f0fdf4' },
  travel: { label: '出行', color: '#d97706', background: '#fffbeb' },
  social: { label: '社交', color: '#9333ea', background: '#faf5ff' },
  health: { label: '健康', color: '#dc2626', background: '#fef2f2' },
  other: { label: '其他', color: '#64748b', background: '#f8fafc' },
};

export function escapeEmailHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function greeting(hour: number): string {
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${year}年${month}月${day}日 ${weekday}`;
}

function scheduleTime(schedule: Schedule): string {
  if (schedule.all_day) return '全天';
  const start = schedule.start_time?.slice(11, 16) || '待定';
  const end = schedule.end_time?.slice(11, 16);
  return end && end !== start ? `${start}–${end}` : start;
}

function weatherLine(weather: DailyWeather | null, locationName?: string | null, weatherError?: string | null): string {
  if (weather) {
    const temperature = weather.temperatureMin == null || weather.temperatureMax == null
      ? ''
      : ` · ${Math.round(weather.temperatureMin)}～${Math.round(weather.temperatureMax)}℃`;
    const rain = weather.precipitationProbabilityMax == null ? '' : ` · 降雨概率最高 ${Math.round(weather.precipitationProbabilityMax)}%`;
    const cacheNote = weather.source === 'cache' || weather.isStale
      ? ` · 使用缓存，仅供参考（已缓存约 ${Math.max(1, Math.round(weather.cacheAgeMs / 60_000))} 分钟）`
      : '';
    return `${locationName ? escapeEmailHtml(locationName) + ' · ' : ''}${escapeEmailHtml(weather.description)}${temperature}${rain}${cacheNote}`;
  }
  if (weatherError) return `${locationName ? escapeEmailHtml(locationName) + ' · ' : ''}天气暂不可用，不影响日程提醒`;
  return locationName ? `${escapeEmailHtml(locationName)} · 尚未取得天气信息` : '设置常驻城市或区县后，可在邮件中查看天气';
}

export function getDailyReminderWeatherSubjectPrefix(weather: DailyWeather | null | undefined): string {
  if (!weather || weather.source === 'cache' || weather.isStale) return '';
  if ([95, 96, 99].includes(weather.weatherCode)) return '[雷暴预警]';
  if ([71, 73, 75, 77, 85, 86].includes(weather.weatherCode)) return '[今天有雪]';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weather.weatherCode)) return '[今天有雨]';
  if (typeof weather.windSpeedMax === 'number' && weather.windSpeedMax >= 40) return '[大风提醒]';
  return '';
}

function actionItemTypeLabel(item: ActionItem): string {
  return item.itemType === 'recurring' ? '周期事务' : item.itemType === 'todo' ? '待办' : '日程';
}

function actionItemDueLabel(item: ActionItem, sectionTitle: string): string {
  if (sectionTitle === '无固定期限') return '无固定期限';
  const date = item.dueAt?.slice(0, 10) || '日期待定';
  const time = item.allDay ? '全天' : item.dueAt?.slice(11, 16) || '时间待定';
  return `逾期 · ${date}${time === '全天' ? ' · 全天' : ` · ${time}`}`;
}

function renderBacklogSection(title: string, items: ActionItem[], appUrl: string): string {
  if (!items.length) return '';
  const visible = items.slice(0, 10);
  const overflow = Math.max(0, items.length - visible.length);
  const accent = title === '已逾期' ? '#dc2626' : '#7c3aed';
  const background = title === '已逾期' ? '#fef2f2' : '#faf5ff';
  const rows = visible.map(item => `
    <tr><td style="padding:0 0 8px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:${background};border:1px solid #e2e8f0;border-left:4px solid ${accent};border-radius:9px">
        <tr><td style="padding:11px 12px;vertical-align:top">
          <div style="font-size:11px;color:${accent};font-weight:700;margin-bottom:4px">${actionItemTypeLabel(item)} · ${actionItemDueLabel(item, title)}</div>
          <div style="font-size:14px;line-height:1.45;color:#0f172a;font-weight:700">${escapeEmailHtml(item.title)}</div>
          ${item.nextAction ? `<div style="margin-top:4px;color:#64748b;font-size:12px;line-height:1.5">下一步：${escapeEmailHtml(item.nextAction)}</div>` : ''}
        </td></tr>
      </table>
    </td></tr>`).join('');
  const overflowLine = overflow > 0
    ? `<div style="margin-top:2px;font-size:12px;line-height:1.5;color:#64748b">还有 ${overflow} 项，<a href="${escapeEmailHtml(appUrl)}" style="color:${accent};font-weight:700">打开行动中心查看全部</a>。</div>`
    : '';
  return `<tr><td style="padding:0 26px 8px">
    <div style="margin:8px 0 9px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:15px;color:${accent};font-weight:800">${title} <span style="font-size:12px;font-weight:600;color:#64748b">${items.length} 项</span></div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table>
    ${overflowLine}
  </td></tr>`;
}

export function renderDailyReminderEmail(input: {
  date: string;
  hour: number;
  schedules: Schedule[];
  appUrl: string;
  overdue?: ActionItem[];
  unscheduled?: ActionItem[];
  locationName?: string | null;
  weather?: DailyWeather | null;
  weatherError?: string | null;
}): { subject: string; html: string } {
  const schedules = [...input.schedules].sort((left, right) => left.start_time.localeCompare(right.start_time));
  const pending = schedules.filter(schedule => !schedule.is_completed);
  const overdue = [...(input.overdue || [])];
  const unscheduled = [...(input.unscheduled || [])].filter(item => item.itemType === 'todo');
  const backlogCount = overdue.length + unscheduled.length;
  const allCompleted = schedules.length > 0 && pending.length === 0;
  const baseSubject = pending.length === 0 && backlogCount > 0
    ? `${input.date.slice(5)} 今日 0 项，另有 ${backlogCount} 项待整理`
    : schedules.length === 0
      ? '太好了，今天没有安排日程'
      : allCompleted
        ? '今天的安排已全部完成'
        : `${input.date.slice(5)} 今日还有 ${pending.length} 项安排`;
  const weatherPrefix = getDailyReminderWeatherSubjectPrefix(input.weather);
  const subject = weatherPrefix ? `${weatherPrefix} ${baseSubject}` : baseSubject;
  const intro = pending.length === 0 && backlogCount > 0
    ? `今天没有待处理安排，另有 ${backlogCount} 项待整理。`
    : schedules.length === 0
      ? '今天没有安排，留一点时间给休息、阅读或临时灵感。'
      : allCompleted
        ? '今天安排的事项已经全部完成，辛苦了。'
        : `今天共有 ${schedules.length} 项安排，其中 ${pending.length} 项尚未完成。`;
  const rows = schedules.map(schedule => {
    const meta = CATEGORY_META[schedule.category] || CATEGORY_META.other;
    const detailRows = [
      schedule.location ? `<div style="margin-top:5px;color:#475569;font-size:13px">地点：${escapeEmailHtml(schedule.location)}</div>` : '',
      schedule.notes ? `<div style="margin-top:5px;color:#64748b;font-size:13px;line-height:1.55">备注：${escapeEmailHtml(schedule.notes)}</div>` : '',
    ].join('');
    return `
      <tr><td style="padding:0 0 12px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:${meta.background};border:1px solid #e2e8f0;border-left:5px solid ${meta.color};border-radius:10px">
          <tr>
            <td style="padding:14px 15px;vertical-align:top">
              <div style="font-size:12px;color:${meta.color};font-weight:700;margin-bottom:5px">${meta.label} · ${escapeEmailHtml(scheduleTime(schedule))}</div>
              <div style="font-size:16px;line-height:1.45;color:#0f172a;font-weight:700;${schedule.is_completed ? 'text-decoration:line-through;opacity:.65' : ''}">${escapeEmailHtml(schedule.title)}</div>
              ${detailRows}
            </td>
            <td style="width:74px;padding:14px 14px 14px 4px;text-align:right;vertical-align:top;font-size:12px;color:${schedule.is_completed ? '#15803d' : '#64748b'}">${schedule.is_completed ? '已完成' : schedule.priority === 'high' ? '高优先级' : '待处理'}</td>
          </tr>
        </table>
      </td></tr>`;
  }).join('');

  return {
    subject,
    html: `<!doctype html>
<html lang="zh-CN"><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f1f5f9">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
        <tr><td style="padding:28px 26px 16px">
          <div style="font-size:13px;color:#2563eb;font-weight:700;letter-spacing:.04em">AI CALENDAR · 每日提醒</div>
          <h1 style="font-size:24px;line-height:1.35;margin:9px 0 6px;color:#0f172a">${greeting(input.hour)}</h1>
          <div style="font-size:14px;color:#64748b">${dateLabel(input.date)}</div>
        </td></tr>
        <tr><td style="padding:0 26px 18px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:#eff6ff;border-radius:10px">
            <tr><td style="padding:12px 14px;font-size:13px;line-height:1.6;color:#1e3a8a">${weatherLine(input.weather || null, input.locationName, input.weatherError)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 26px 15px;font-size:14px;line-height:1.7;color:#475569">${intro}</td></tr>
        ${schedules.length ? `<tr><td style="padding:0 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table></td></tr>` : ''}
        ${renderBacklogSection('已逾期', overdue, input.appUrl)}
        ${renderBacklogSection('无固定期限', unscheduled, input.appUrl)}
        <tr><td style="padding:10px 26px 28px;text-align:center">
          <a href="${escapeEmailHtml(input.appUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 20px;border-radius:9px">打开今日行动中心</a>
          <div style="margin-top:16px;font-size:11px;line-height:1.5;color:#94a3b8">天气来自 Open-Meteo；提醒内容以 AI Calendar 当前数据为准。</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  };
}
