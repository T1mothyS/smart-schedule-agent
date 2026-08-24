import assert from 'node:assert/strict';
import test from 'node:test';

import { renderDailyReminderEmail } from './daily-email-template.js';
import type { Schedule } from './schedule-store.js';

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'schedule-1',
    user_id: 'user-1',
    calendar_id: 'calendar-1',
    type: 'event',
    title: '项目会议',
    start_time: '2026-08-24T09:00:00',
    end_time: '2026-08-24T10:00:00',
    all_day: false,
    category: 'work',
    priority: 'medium',
    is_completed: false,
    is_repeated: false,
    reminders: [],
    is_high_risk: false,
    created_at: '2026-08-24T00:00:00Z',
    updated_at: '2026-08-24T00:00:00Z',
    ...overrides,
  };
}

test('0 条日程使用明确的轻松主题', () => {
  const result = renderDailyReminderEmail({ date: '2026-08-24', hour: 8, schedules: [], appUrl: 'https://example.com/today' });
  assert.equal(result.subject, '太好了，今天没有安排日程');
  assert.match(result.html, /今天没有安排/);
});
test('全部完成使用单独文案并安全转义日程字段', () => {
  const result = renderDailyReminderEmail({
    date: '2026-08-24',
    hour: 19,
    schedules: [schedule({ title: '<script>alert(1)</script>', notes: 'A&B', is_completed: true })],
    appUrl: 'https://example.com/today?a=1&b=2',
  });
  assert.equal(result.subject, '今天的安排已全部完成');
  assert.doesNotMatch(result.html, /<script>/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.match(result.html, /A&amp;B/);
});

test('天气失败时降级但仍保留日程表', () => {
  const result = renderDailyReminderEmail({
    date: '2026-08-24',
    hour: 8,
    schedules: [schedule()],
    appUrl: 'https://example.com/today',
    locationName: '北京市',
    weatherError: 'timeout',
  });
  assert.match(result.html, /天气暂不可用/);
  assert.match(result.html, /项目会议/);
});
