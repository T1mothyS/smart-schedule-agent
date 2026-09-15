import { SCHEDULE_CATEGORY_COLORS, SCHEDULE_CATEGORY_LABELS } from '../../utils/scheduleCategories';

export const CATEGORY_COLORS = SCHEDULE_CATEGORY_COLORS;

export const CATEGORY_LABELS = SCHEDULE_CATEGORY_LABELS;

export const PRIORITY_COLORS: Record<string, { bg: string; border: string; dot: string; label: string }> = {
  high:   { bg: '#FEF2F2', border: '#EF4444', dot: '#EF4444', label: '高优先' },
  medium: { bg: '#FFFBEB', border: '#F59E0B', dot: '#F59E0B', label: '中优先' },
  low:    { bg: '#F0FDF4', border: '#10B981', dot: '#10B981', label: '低优先' },
};

export const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function formatScheduleDate(value: string): { date: string; weekday: string; isToday: boolean } {
  const parsed = parseDateKey(value);
  if (!parsed) return { date: '选择日期', weekday: '', isToday: false };
  return {
    date: parsed.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
    weekday: WEEKDAY_LABELS[parsed.getDay()],
    isToday: toDateKey(parsed) === toDateKey(new Date()),
  };
}

export function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}
