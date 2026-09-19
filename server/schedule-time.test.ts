import assert from 'node:assert/strict';
import test from 'node:test';
import { validateScheduleTime } from './schedule-time.js';
test('one date contract covers local/offset instants and real calendar dates', () => {
  for (const start_time of ['2028-02-29T14:00:00', '2026-09-20T14:00+08:00', '2026-09-20T06:00:00.000Z']) assert.doesNotThrow(() => validateScheduleTime({ type: 'event', start_time }));
  for (const start_time of ['', '2026-02-29T14:00:00', '2026-09-31T14:00:00', '2026-09-20', '2026-09-20T24:00:00', '2026-09-20T14:00:00+99:00']) assert.throws(() => validateScheduleTime({ type: 'event', start_time }));
  assert.doesNotThrow(() => validateScheduleTime({ type: 'event', all_day: true, start_time: '2026-09-20', end_time: '2026-09-21' }));
  assert.doesNotThrow(() => validateScheduleTime({ type: 'event', all_day: true, start_time: '2026-09-20', end_time: '2026-09-20T00:00:00' }));
  assert.throws(() => validateScheduleTime({ type: 'event', all_day: true, start_time: '2026-09-20T00:00:00', end_time: '2026-09-19' }), /早于/);
  assert.throws(() => validateScheduleTime({ type: 'event', start_time: '2026-09-20T14:00', end_time: '2026-09-20T13:00' }), /早于/);
  assert.throws(() => validateScheduleTime({ type: 'event', start_time: '2026-09-20T14:00', end_time: '2026-09-20T15:00Z' }), /时区/);
  assert.doesNotThrow(() => validateScheduleTime({ type: 'todo', start_time: '2026-09-20T14:00', end_time: 'ignored' }));
  assert.doesNotThrow(() => validateScheduleTime({ type: 'todo', is_unscheduled: true }));
  assert.throws(() => validateScheduleTime({ type: 'todo', is_unscheduled: true, all_day: true }), /无固定期限/);
});
