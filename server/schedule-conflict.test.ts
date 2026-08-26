import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFLICT_DISMISS_TTL_MS,
  buildConflictKey,
  checkScheduleConflict,
  getConflictPairs,
  isConflictDismissed,
  parseScheduleDate,
  type ConflictDismissal,
  type ConflictSchedule,
} from '../src/utils/scheduleConflict.ts';

function schedule(input: Partial<ConflictSchedule> & Pick<ConflictSchedule, 'id' | 'type' | 'start_time'>): ConflictSchedule {
  return {
    title: input.title || input.id,
    end_time: input.end_time,
    all_day: input.all_day || false,
    updated_at: input.updated_at || '2026-08-20T00:00:00.000Z',
    ...input,
  };
}

test('event 和 todo 使用同一套有效冲突判断', () => {
  const event = schedule({ id: 'event', type: 'event', start_time: '2026-08-21T09:00:00', end_time: '2026-08-21T10:00:00' });
  const todo = schedule({ id: 'todo', type: 'todo', start_time: '2026-08-21T09:30:00', end_time: '2026-08-21T10:30:00' });
  const now = parseScheduleDate('2026-08-20T12:00:00').getTime();

  assert.equal(checkScheduleConflict(event, todo), true);
  assert.equal(getConflictPairs([event, todo], now).length, 1);
});

test('无结束时间待办按时间点参与冲突，不扩展为一小时', () => {
  const todo = schedule({ id: 'point-todo', type: 'todo', start_time: '2026-08-21T09:00:00' });
  const laterEvent = schedule({ id: 'later-event', type: 'event', start_time: '2026-08-21T09:30:00', end_time: '2026-08-21T10:00:00' });
  const sameStartEvent = schedule({ id: 'same-start-event', type: 'event', start_time: '2026-08-21T09:00:00', end_time: '2026-08-21T10:00:00' });

  assert.equal(checkScheduleConflict(todo, laterEvent), false);
  assert.equal(checkScheduleConflict(todo, sameStartEvent), true);
});

test('今天和未来的冲突可见，已经结束的冲突隐藏', () => {
  const today = schedule({ id: 'today', type: 'event', start_time: '2026-08-20T09:00:00', end_time: '2026-08-20T10:00:00' });
  const todayTodo = schedule({ id: 'today-todo', type: 'todo', start_time: '2026-08-20T09:30:00', end_time: '2026-08-20T10:30:00' });
  const future = schedule({ id: 'future', type: 'todo', start_time: '2026-08-21T09:00:00', end_time: '2026-08-21T10:00:00' });
  const futureEvent = schedule({ id: 'future-event', type: 'event', start_time: '2026-08-21T09:30:00', end_time: '2026-08-21T10:30:00' });
  const past = schedule({ id: 'past', type: 'event', start_time: '2026-08-19T09:00:00', end_time: '2026-08-19T10:00:00' });
  const pastTodo = schedule({ id: 'past-todo', type: 'todo', start_time: '2026-08-19T09:30:00', end_time: '2026-08-19T10:30:00' });

  assert.equal(getConflictPairs([today, todayTodo], parseScheduleDate('2026-08-20T09:30:00').getTime()).length, 1);
  assert.equal(getConflictPairs([future, futureEvent], parseScheduleDate('2026-08-20T12:00:00').getTime()).length, 1);
  assert.equal(getConflictPairs([past, pastTodo], parseScheduleDate('2026-08-20T12:00:00').getTime()).length, 0);
});

test('dismiss 冷却四小时，日程重新安排后生成新冲突键', () => {
  const event = schedule({ id: 'event', type: 'event', start_time: '2026-08-21T09:00:00', end_time: '2026-08-21T10:00:00' });
  const todo = schedule({ id: 'todo', type: 'todo', start_time: '2026-08-21T09:30:00', end_time: '2026-08-21T10:30:00' });
  const key = buildConflictKey([event, todo], new Set(['event', 'todo']));
  const dismissal: ConflictDismissal = { key: key!, dismissedAt: Date.parse('2026-08-20T12:00:00Z') };

  assert.equal(isConflictDismissed(dismissal, key, dismissal.dismissedAt + CONFLICT_DISMISS_TTL_MS - 1), true);
  assert.equal(isConflictDismissed(dismissal, key, dismissal.dismissedAt + CONFLICT_DISMISS_TTL_MS), false);

  const rescheduled = { ...todo, start_time: '2026-08-21T11:00:00', end_time: '2026-08-21T12:00:00', updated_at: '2026-08-20T13:00:00.000Z' };
  const newKey = buildConflictKey([event, rescheduled], new Set(['event', 'todo']));
  assert.notEqual(newKey, key);

  const renamed = { ...todo, title: '只改标题', updated_at: '2026-08-20T13:30:00.000Z' };
  assert.equal(buildConflictKey([event, renamed], new Set(['event', 'todo'])), key);
});
