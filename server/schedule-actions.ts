function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** 保留原始时间部分，只移动日历日期。 */
export function shiftScheduleDateValue(value: string, days = 1): string {
  const raw = String(value || '');
  const date = raw.slice(0, 10);
  if (!isValidDateKey(date)) throw new Error('日程日期格式不正确');
  return addDays(date, days) + raw.slice(10);
}
