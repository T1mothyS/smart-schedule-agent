import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftScheduleDateValue } from './schedule-actions.js';

test('顺延日程只改变日期并保留时间与时区后缀', () => {
  assert.equal(shiftScheduleDateValue('2026-02-28T23:30:00+08:00'), '2026-03-01T23:30:00+08:00');
  assert.equal(shiftScheduleDateValue('2026-12-31'), '2027-01-01');
});

test('顺延日程拒绝无效日期', () => {
  assert.throws(() => shiftScheduleDateValue('2026-02-30T09:00:00'), /日程日期格式不正确/);
  assert.throws(() => shiftScheduleDateValue(''), /日程日期格式不正确/);
});
