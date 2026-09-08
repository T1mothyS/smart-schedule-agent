import assert from 'node:assert/strict';
import test from 'node:test';

import { renderDailyReminderEmail } from './daily-email-template.js';
import type { DailyWeather } from './weather-service.js';
import type { Schedule } from './schedule-store.js';
import type { ActionItem } from './action-center.js';

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

function actionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'schedule:backlog-1',
    sourceType: 'schedule',
    sourceId: 'backlog-1',
    instanceId: null,
    title: '逾期事项',
    dueAt: '2026-08-23T09:00:00',
    allDay: false,
    status: 'overdue',
    priority: 'medium',
    nextAction: '尽快处理',
    itemType: 'todo',
    isUnscheduled: false,
    completedAt: null,
    completionId: null,
    proof: null,
    ...overrides,
  };
}

function weather(weatherCode: number, windSpeedMax = 18): DailyWeather {
  return {
    date: '2026-08-24',
    timezone: 'Asia/Shanghai',
    weatherCode,
    description: '测试天气',
    temperatureMax: 30,
    temperatureMin: 23,
    precipitationProbabilityMax: 70,
    windSpeedMax,
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

test('每日提醒标题根据天气增加单一高优先级提示', () => {
  const base = { date: '2026-08-24', hour: 8, schedules: [], appUrl: 'https://example.com/today' };
  assert.equal(renderDailyReminderEmail({ ...base, weather: weather(61) }).subject, '[今天有雨] 太好了，今天没有安排日程');
  assert.equal(renderDailyReminderEmail({ ...base, weather: weather(71) }).subject, '[今天有雪] 太好了，今天没有安排日程');
  assert.equal(renderDailyReminderEmail({ ...base, weather: weather(95, 80) }).subject, '[雷暴预警] 太好了，今天没有安排日程');
  assert.equal(renderDailyReminderEmail({ ...base, weather: weather(3, 40) }).subject, '[大风提醒] 太好了，今天没有安排日程');
  assert.equal(renderDailyReminderEmail({ ...base, weatherError: 'timeout' }).subject, '太好了，今天没有安排日程');
});

test('今日没有待处理安排时显示积压摘要，并限制每组最多十项', () => {
  const result = renderDailyReminderEmail({
    date: '2026-09-02',
    hour: 8,
    schedules: [],
    overdue: Array.from({ length: 11 }, (_, index) => actionItem({
      id: `schedule:overdue-${index}`,
      sourceId: `overdue-${index}`,
      title: `逾期事项 ${index + 1}`,
    })),
    unscheduled: [
      actionItem({ id: 'schedule:unscheduled-1', sourceId: 'unscheduled-1', title: '无日期待办', status: 'today', isUnscheduled: true }),
      actionItem({ id: 'schedule:unscheduled-event', sourceId: 'unscheduled-event', title: '不应进入无固定期限组', itemType: 'event', status: 'today', isUnscheduled: true }),
    ],
    appUrl: 'https://example.com/action-center',
  });
  assert.equal(result.subject, '09-02 今日 0 项，另有 12 项待整理');
  assert.match(result.html, /已逾期/);
  assert.match(result.html, /无固定期限/);
  assert.match(result.html, /还有 1 项/);
  assert.match(result.html, /打开行动中心查看全部/);
  assert.match(result.html, /无日期待办/);
  assert.doesNotMatch(result.html, /不应进入无固定期限组/);
  assert.doesNotMatch(result.html, /逾期事项 11/);
});
