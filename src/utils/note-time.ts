export const NOTE_TIME_ZONE = 'Asia/Shanghai';
export const NOTE_TIME_ZONE_LABEL = '北京时间';

function dateTimeParts(date: Date): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: NOTE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
}

export function formatNoteDateTime(value: string | null): string {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ').slice(0, 16);
  const parts = dateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function noteDateKey(date = new Date()): string {
  const parts = dateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
