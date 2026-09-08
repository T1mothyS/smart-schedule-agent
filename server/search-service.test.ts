import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-search-test-'));
process.env.DATA_DIR = tempDir;

const db = await import('./db.js');
const activity = await import('./activity-store.js');
const scheduleStore = await import('./schedule-store.js');
const library = await import('./library-service.js');
const { searchAll } = await import('./search-service.js');

await db.initDb();
await activity.initActivityDb();
await scheduleStore.initScheduleDb();

const userId = 'search-user';
const otherUserId = 'search-other-user';
const now = new Date().toISOString();
for (const [id, email] of [[userId, 'search@example.com'], [otherUserId, 'other-search@example.com']] as const) {
  db.createUser({
    id,
    email,
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
}

scheduleStore.createSchedule({
  id: 'search-schedule',
  user_id: userId,
  calendar_id: 'personal',
  type: 'event',
  title: '和产品团队讨论搜索设计',
  description: '确认统一搜索和日程直达',
  start_time: '2026-09-08T10:00:00+08:00',
  end_time: '2026-09-08T11:00:00+08:00',
  all_day: false,
  is_unscheduled: false,
  location: '会议室',
  notes: '记录搜索验收标准',
  category: 'work',
  priority: 'high',
  is_completed: false,
  is_repeated: false,
  reminders: [],
  is_high_risk: false,
});
db.createNoteItem({
  id: 'search-note',
  user_id: userId,
  content: '记下搜索页面需要在手机端可用',
  completed: 0,
  completed_at: null,
  color: 'neutral',
  linked_schedule_ids: '[]',
  created_at: now,
  updated_at: now,
});
activity.createDailyReport({
  userId,
  reportDate: '2026-09-07',
  markdown: '# 日报\n\n今天验证了统一搜索发布流程。',
  contentHash: 'search-report-hash',
});
library.createLibraryEntry(userId, {
  kind: 'article',
  type: 'knowledge',
  title: '搜索系统设计原则',
  content: '统一搜索需要保留权限边界和可解释的结果排序。',
  summary: '记录搜索设计原则',
  tags: ['搜索', '权限'],
  status: 'active',
  sourceType: 'manual',
});
scheduleStore.createSchedule({
  id: 'other-search-schedule',
  user_id: otherUserId,
  calendar_id: 'personal',
  type: 'event',
  title: '其他用户的搜索日程',
  start_time: '2026-09-08T12:00:00+08:00',
  end_time: '2026-09-08T13:00:00+08:00',
  all_day: false,
  is_unscheduled: false,
  category: 'work',
  priority: 'medium',
  is_completed: false,
  is_repeated: false,
  reminders: [],
  is_high_risk: false,
});

test('统一搜索覆盖日程、记事、日报和知识库，并返回日程直达地址', () => {
  const result = searchAll(userId, { query: '搜索', scope: 'all' });
  assert.deepEqual(Object.keys(result.counts).sort(), ['library', 'note', 'report', 'schedule']);
  assert.ok(result.results.some(item => item.type === 'schedule'));
  assert.ok(result.results.some(item => item.type === 'note'));
  assert.ok(result.results.some(item => item.type === 'report'));
  assert.ok(result.results.some(item => item.type === 'library'));
  const schedule = result.results.find(item => item.type === 'schedule');
  assert.match(schedule?.target.path || '', /\/schedule\?date=2026-09-08&schedule=search-schedule/);
});

test('统一搜索按 scope 过滤，并隔离其他账号数据', () => {
  const scheduleOnly = searchAll(userId, { query: '搜索', scope: 'schedule' });
  assert.ok(scheduleOnly.results.every(item => item.type === 'schedule'));
  assert.equal(searchAll(userId, { query: '其他用户', scope: 'all' }).results.length, 0);
});
