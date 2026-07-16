import { Solar } from 'lunar-javascript';

export interface CalendarDayMeta {
  lunarLabel: string;
  lunarFullLabel: string;
  solarTerm: string;
  festivals: string[];
}

const CHINESE_SOLAR_FESTIVALS: Record<string, string> = {
  '01-01': '元旦',
  '05-01': '劳动节',
  '09-10': '教师节',
  '10-01': '国庆节',
};

const WESTERN_FIXED_FESTIVALS: Record<string, string> = {
  '02-14': '情人节',
  '04-01': '愚人节',
  '10-31': '万圣节',
  '12-25': '圣诞节',
};

const ALLOWED_LUNAR_FESTIVALS = new Set([
  '春节', '元宵节', '端午节', '七夕节', '中秋节', '重阳节', '腊八节', '除夕',
]);

const LUNAR_NAME_MAP: Record<string, string> = {
  元宵节: '元宵',
  端午节: '端午',
  七夕节: '七夕',
  中秋节: '中秋',
  重阳节: '重阳',
  腊八节: '腊八',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addCalendarDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  result.setHours(0, 0, 0, 0);
  return result;
}

function nthWeekdayOfMonth(date: Date, weekday: number, nth: number): boolean {
  if (date.getDay() !== weekday) return false;
  return Math.floor((date.getDate() - 1) / 7) + 1 === nth;
}

function getRuleFestival(date: Date): string | null {
  const month = date.getMonth() + 1;
  if (month === 5 && nthWeekdayOfMonth(date, 0, 2)) return '母亲节';
  if (month === 6 && nthWeekdayOfMonth(date, 0, 3)) return '父亲节';
  if (month === 11 && nthWeekdayOfMonth(date, 4, 4)) return '感恩节';
  return null;
}

export function getCalendarDayMeta(date: Date): CalendarDayMeta {
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const lunar = solar.getLunar();
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const lunarMonth = lunar.getMonthInChinese();
  const lunarDay = lunar.getDayInChinese();
  const lunarFestivals = [...lunar.getFestivals(), ...lunar.getOtherFestivals()]
    .filter(name => ALLOWED_LUNAR_FESTIVALS.has(name))
    .map(name => LUNAR_NAME_MAP[name] || name);
  const festivals = [
    ...lunarFestivals,
    CHINESE_SOLAR_FESTIVALS[monthDay],
    WESTERN_FIXED_FESTIVALS[monthDay],
    getRuleFestival(date),
  ].filter((value): value is string => Boolean(value));

  return {
    lunarLabel: lunarDay === '初一' ? `${lunarMonth}月` : lunarDay,
    lunarFullLabel: `${lunarMonth}月${lunarDay}`,
    solarTerm: lunar.getJieQi() || '',
    festivals: Array.from(new Set(festivals)),
  };
}

export function getPrimaryCalendarLabel(date: Date): string {
  const meta = getCalendarDayMeta(date);
  return meta.festivals[0] || meta.solarTerm || meta.lunarLabel;
}
