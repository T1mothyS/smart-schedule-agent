export interface ConflictSchedule {
  id: string;
  type: 'event' | 'todo';
  title: string;
  start_time: string;
  end_time?: string | null;
  all_day: boolean;
  updated_at?: string | null;
}

export interface ConflictPair<T extends ConflictSchedule = ConflictSchedule> {
  a: T;
  b: T;
}

export interface ConflictDismissal {
  key: string;
  dismissedAt: number;
}

export const CONFLICT_DISMISS_TTL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;
const DEFAULT_TODO_POINT_DURATION_MS = 60 * 1000;

/**
 * Parse a schedule timestamp while preserving the existing local-calendar
 * semantics for values without an explicit timezone suffix.
 */
export function parseScheduleDate(value: string): Date {
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return new Date(value);

  const [datePart, timePart = '00:00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hourPart = '0', minutePart = '0', secondPart = '0'] = timePart.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  const second = Number.parseFloat(secondPart);
  return new Date(
    year,
    month - 1,
    day,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    Number.isFinite(second) ? second : 0,
  );
}

function getScheduleRange(schedule: ConflictSchedule): { start: number; end: number } | null {
  const start = parseScheduleDate(schedule.start_time).getTime();
  if (!Number.isFinite(start)) return null;
  // 待办没有持续时长；这里仅用一分钟的内存时间窗判断同一时间点的冲突，绝不回写 end_time。
  const fallbackDuration = schedule.type === 'todo'
    ? DEFAULT_TODO_POINT_DURATION_MS
    : DEFAULT_EVENT_DURATION_MS;
  const end = schedule.end_time
    ? parseScheduleDate(schedule.end_time).getTime()
    : start + fallbackDuration;
  if (!Number.isFinite(end)) return null;
  return { start, end };
}

export function isTimedConflictSchedule(schedule: ConflictSchedule): boolean {
  return !schedule.all_day && (schedule.type === 'event' || schedule.type === 'todo');
}

export function checkScheduleConflict(a: ConflictSchedule, b: ConflictSchedule): boolean {
  if (!isTimedConflictSchedule(a) || !isTimedConflictSchedule(b)) return false;
  const aRange = getScheduleRange(a);
  const bRange = getScheduleRange(b);
  if (!aRange || !bRange) return false;
  return aRange.start < bRange.end && aRange.end > bRange.start;
}

export function isVisibleScheduleConflict(a: ConflictSchedule, b: ConflictSchedule, nowMs = Date.now()): boolean {
  if (!checkScheduleConflict(a, b)) return false;
  const aRange = getScheduleRange(a);
  const bRange = getScheduleRange(b);
  if (!aRange || !bRange) return false;
  return Math.min(aRange.end, bRange.end) > nowMs;
}

export function getConflictPairs<T extends ConflictSchedule>(schedules: T[], nowMs = Date.now()): ConflictPair<T>[] {
  const activeSchedules = schedules.filter(isTimedConflictSchedule);
  const pairs: ConflictPair<T>[] = [];
  for (let i = 0; i < activeSchedules.length; i += 1) {
    for (let j = i + 1; j < activeSchedules.length; j += 1) {
      if (isVisibleScheduleConflict(activeSchedules[i], activeSchedules[j], nowMs)) {
        pairs.push({ a: activeSchedules[i], b: activeSchedules[j] });
      }
    }
  }
  return pairs;
}

export function getConflictingScheduleIds<T extends ConflictSchedule>(schedules: T[], nowMs = Date.now()): Set<string> {
  const ids = new Set<string>();
  for (const { a, b } of getConflictPairs(schedules, nowMs)) {
    ids.add(a.id);
    ids.add(b.id);
  }
  return ids;
}

export function groupConflictingSchedulesByTimeSlot<T extends ConflictSchedule>(
  schedules: T[],
  nowMs = Date.now(),
): Map<string, T[]> {
  const conflictMap = new Map<string, T[]>();
  const conflictPairs = getConflictPairs(schedules, nowMs).sort((a, b) =>
    parseScheduleDate(a.a.start_time).getTime() - parseScheduleDate(b.a.start_time).getTime(),
  );

  const processedIds = new Set<string>();
  for (const { a, b } of conflictPairs) {
    const key = `${Math.floor(parseScheduleDate(a.start_time).getTime() / 60000)}_${Math.floor(parseScheduleDate(b.start_time).getTime() / 60000)}`;
    if (!conflictMap.has(key)) conflictMap.set(key, []);
    const group = conflictMap.get(key)!;
    if (!processedIds.has(a.id)) {
      group.push(a);
      processedIds.add(a.id);
    }
    if (!processedIds.has(b.id)) {
      group.push(b);
      processedIds.add(b.id);
    }
  }
  return conflictMap;
}

export function getConflictExpiryAt<T extends ConflictSchedule>(pairs: ConflictPair<T>[]): number | null {
  const endTimes = pairs.flatMap(({ a, b }) => {
    const aRange = getScheduleRange(a);
    const bRange = getScheduleRange(b);
    return aRange && bRange ? [Math.min(aRange.end, bRange.end)] : [];
  });
  return endTimes.length ? Math.min(...endTimes) : null;
}

export function buildConflictKey<T extends ConflictSchedule>(schedules: T[], conflictingIds: Set<string>): string | null {
  const items = schedules
    .filter(schedule => conflictingIds.has(schedule.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(schedule => `${schedule.id}:${schedule.start_time}:${schedule.end_time || ''}`);
  return items.length ? items.join('|') : null;
}

export function isConflictDismissed(
  dismissal: ConflictDismissal | null,
  conflictKey: string | null,
  nowMs = Date.now(),
): boolean {
  return Boolean(
    dismissal &&
    conflictKey &&
    dismissal.key === conflictKey &&
    nowMs - dismissal.dismissedAt < CONFLICT_DISMISS_TTL_MS,
  );
}
