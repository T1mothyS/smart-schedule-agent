import { createHash } from 'node:crypto';
import type { Schedule } from './schedule-store.js';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class CaldavError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export interface ProjectionOptions { timezone: string; alarms: boolean }
export interface ProjectedEvent { key: string; sourceId: string; ical: string; hash: string }
export const DEFAULT_EVENT_DURATION_MINUTES = 60;

function escapeText(value: string): string {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new CaldavError('UNSUPPORTED_CONTROL_CHARACTER');
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
function fold(line: string): string {
  const result: string[] = []; let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char) > 75) { result.push(current); current = ' '; }
    current += char;
  }
  return [...result, current].join('\r\n');
}
function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CaldavError('INVALID_DATE');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '2000-01-01') throw new CaldavError('UNSUPPORTED_DATE');
  return value;
}
function instant(value: string, timezone: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new CaldavError('INVALID_TIME');
  validDate(match[1]);
  if (+match[2] > 23 || +match[3] > 59 || +(match[4] || 0) > 59) throw new CaldavError('INVALID_TIME');
  const offset = match[6] || (timezone === 'UTC' ? 'Z' : '+08:00');
  if (offset !== 'Z' && (+offset.slice(1, 3) > 23 || +offset.slice(4) > 59)) throw new CaldavError('INVALID_TIME');
  const parsed = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4] || '00'}${match[5] ? '.' + match[5] : ''}${offset}`);
  if (!Number.isFinite(parsed.getTime())) throw new CaldavError('INVALID_TIME');
  return parsed;
}
const utc = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

// This is a comparison for OUR bounded VEVENT grammar, not a general ICS parser.
// Radicale may reorder properties or refold lines. All nonempty values remain significant.
export function icalHash(value: string): string {
  return digest(value.replace(/\r\n[ \t]/g, '').split(/\r?\n/).filter(Boolean).sort().join('\n'));
}

export function projectEvent(event: Schedule, options: ProjectionOptions): ProjectedEvent {
  if (!['Asia/Shanghai', 'Asia/Hong_Kong', 'UTC'].includes(options.timezone)) throw new CaldavError('UNSUPPORTED_TIMEZONE');
  if (event.is_repeated && !['daily', 'weekly'].includes(event.repeat_rule || '')) throw new CaldavError('UNSUPPORTED_RECURRENCE');
  if (!event.is_repeated && event.repeat_rule) throw new CaldavError('INCONSISTENT_RECURRENCE');
  if (!event.title.trim()) throw new CaldavError('MISSING_TITLE');
  const id = digest(JSON.stringify([event.user_id, event.calendar_id, event.id]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Calendar//One-way bridge v1//EN',
    'BEGIN:VEVENT', `UID:aical-${id}@calendar.invalid`,
    `DTSTAMP:${utc(instant(event.updated_at, 'UTC'))}`, `CREATED:${utc(instant(event.created_at, 'UTC'))}`,
    `LAST-MODIFIED:${utc(instant(event.updated_at, 'UTC'))}`, `SUMMARY:${escapeText(event.title)}`];
  if (event.all_day) {
    // Existing UI defines a single local date with no end; do not guess legacy spans.
    if (!/^\d{4}-\d{2}-\d{2}(?:T00:00:00)?$/.test(event.start_time) || event.end_time) throw new CaldavError('AMBIGUOUS_ALL_DAY_RANGE');
    const day = validDate(event.start_time.slice(0, 10));
    const end = new Date(day + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${day.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, '')}`);
  } else {
    const start = instant(event.start_time, options.timezone);
    lines.push(`DTSTART:${utc(start)}`);
    // Source data may intentionally omit an end time. Keep the website value unchanged,
    // but emit a finite target duration because some CalDAV clients hide start-only events.
    const end = event.end_time
      ? instant(event.end_time, options.timezone)
      : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60_000);
    if (end.getTime() <= start.getTime()) throw new CaldavError('INVALID_DURATION');
    lines.push(`DTEND:${utc(end)}`);
  }
  if (event.is_repeated) lines.push(`RRULE:FREQ=${event.repeat_rule!.toUpperCase()}`);
  const description = [event.description, event.notes].filter(Boolean).join('\n\n');
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (options.alarms && event.reminders.length) {
    // One alarm matches the existing form; multiple legacy reminders need explicit semantics.
    if (event.all_day || event.reminders.length !== 1 || !/^\d{1,5}$/.test(event.reminders[0]) || +event.reminders[0] > 10080) throw new CaldavError('UNSUPPORTED_ALARM');
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${+event.reminders[0]}M`, 'DESCRIPTION:AI Calendar', 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const ical = lines.map(fold).join('\r\n') + '\r\n';
  if (Buffer.byteLength(ical) > 128 * 1024) throw new CaldavError('EVENT_TOO_LARGE');
  return { key: `aical-${id}.ics`, sourceId: event.id, ical, hash: icalHash(ical) };
}
