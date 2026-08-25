import assert from 'node:assert/strict';
import test from 'node:test';
import { protectCsvFormula, renderSchedulesCsv } from './export-service.js';
import type { Schedule } from './schedule-store.js';

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'schedule-export',
    user_id: 'user-one',
    calendar_id: 'calendar-one',
    type: 'event',
    title: '季度复盘, "重要"',
    start_time: '2026-08-24T09:00:00+08:00',
    end_time: '2026-08-24T10:00:00+08:00',
    all_day: false,
    is_unscheduled: false,
    category: 'work',
    priority: 'high',
    is_completed: false,
    is_repeated: false,
    reminders: [],
    is_high_risk: false,
    created_at: '2026-08-20T00:00:00.000Z',
    updated_at: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

test('CSV 使用 UTF-8 BOM、CRLF 并正确转义引号和逗号', () => {
  const csv = renderSchedulesCsv([schedule()]);
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.match(csv, /"季度复盘, ""重要"""/);
  assert.equal(csv.endsWith('\r\n'), true);
});

test('CSV 阻止 Excel 公式注入', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tformula', '\rformula']) {
    assert.equal(protectCsvFormula(value), `'${value}`);
  }
  const csv = renderSchedulesCsv([schedule({ title: '=HYPERLINK("https://example.com")' })]);
  assert.match(csv, /'=/);
});

test('CSV 不修改普通文本', () => {
  assert.equal(protectCsvFormula('普通日程'), '普通日程');
});
