import test from 'node:test';
import assert from 'node:assert/strict';
import { getCalendarDayMeta, toLocalDateKey } from '../src/components/calendar/calendarMeta';

test('中国传统节日按农历日期识别', () => {
  assert.ok(getCalendarDayMeta(new Date(2026, 1, 17)).festivals.includes('春节'));
  assert.ok(getCalendarDayMeta(new Date(2026, 5, 19)).festivals.includes('端午'));
  assert.ok(getCalendarDayMeta(new Date(2026, 8, 25)).festivals.includes('中秋'));
});

test('固定日期与星期规则节日正确识别', () => {
  assert.ok(getCalendarDayMeta(new Date(2026, 11, 25)).festivals.includes('圣诞节'));
  assert.ok(getCalendarDayMeta(new Date(2026, 4, 10)).festivals.includes('母亲节'));
  assert.ok(getCalendarDayMeta(new Date(2026, 5, 21)).festivals.includes('父亲节'));
  assert.ok(getCalendarDayMeta(new Date(2026, 10, 26)).festivals.includes('感恩节'));
});

test('本地日期键不受 UTC 日期偏移影响', () => {
  assert.equal(toLocalDateKey(new Date(2026, 6, 16, 0, 0, 0)), '2026-07-16');
});
