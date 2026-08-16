import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const db = await import('./db.js');
const schedules = await import('./schedule-store.js');
const reminders = await import('./reminder-store.js');
const reminderCalendarSync = await import('./reminder-calendar-sync.js');
const activity = await import('./activity-store.js');
const attachments = await import('./attachment-service.js');
const backups = await import('./backup-service.js');
const actionCenter = await import('./action-center.js');
const scheduleCompletion = await import('./schedule-completion-service.js');
const email = await import('./email-service.js');
const emailImport = await import('./email-import-service.js');

await db.initDb();
await schedules.initScheduleDb();
await reminders.initReminderDb();
await activity.initActivityDb();

const userId = 'test-user';
db.createUser({
  id: userId,
  email: 'test@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

test('不存在的账单日按该月最后一天计算', () => {
  assert.equal(reminders.clampDateForMonth(2025, 2, 31), '2025-02-28');
  assert.equal(reminders.clampDateForMonth(2024, 2, 31), '2024-02-29');
  assert.equal(reminders.clampDateForMonth(2026, 4, 31), '2026-04-30');
});

test('未来年度周期使用明确填写的本期到期日，编辑后同步当前周期', () => {
  const task = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '车辆年检日期测试',
    config: {
      templateKey: 'vehicle_inspection',
      rule: { frequency: 'yearly', anchorDate: '2027-04-18', month: 4, dayOfMonth: 18, interval: 1, advancePolicy: 'calendar' },
      reminderOffsets: [30, 7, 1],
      reminderTime: '09:00',
      actionGuide: '预约年检',
      priority: 'medium',
    },
  });
  assert.equal(task.currentCycle?.dueDate, '2027-04-18');
  assert.equal(task.currentCycle?.status, 'pending');

  const updated = reminders.updateReminderTask(task.id, userId, {
    config: {
      ...(task.config as reminders.GenericReminderConfig),
      rule: { frequency: 'yearly', anchorDate: '2028-05-19', month: 5, dayOfMonth: 19, interval: 1, advancePolicy: 'calendar' },
    },
  });
  assert.equal(updated?.currentCycle?.dueDate, '2028-05-19');
  assert.equal(updated?.currentCycle?.status, 'pending');
});

test('编辑 SIM 卡提前天数会重建当前周期的待发送提醒', () => {
  const lastOperationDate = reminders.todayInTimezone();
  const task = reminders.createReminderTask({
    userId,
    type: 'sim',
    name: 'SIM 卡提醒编辑测试',
    config: {
      provider: '测试运营商',
      numberMasked: '138****0000',
      region: '中国大陆',
      intervalDays: 60,
      lastOperationDate,
      actionGuide: '测试操作',
      reminderOffsets: [10],
      reminderTime: '09:00',
      priority: 'medium',
    },
  });
  const firstNextDate = task.nextReminderDate;
  const updated = reminders.updateReminderTask(task.id, userId, {
    config: {
      ...(task.config as reminders.SimConfig),
      reminderOffsets: [3],
    },
  });

  assert.equal(firstNextDate, reminders.addDays(task.currentCycle!.dueDate, -10));
  assert.equal(updated?.nextReminderDate, reminders.addDays(task.currentCycle!.dueDate, -3));
  assert.notEqual(updated?.nextReminderDate, firstNextDate);
});

test('邮件测试时间按 GMT+8 输出', () => {
  assert.equal(
    email.formatDateTimeInTimezone(new Date('2026-07-15T15:11:00.000Z'), 'Asia/Shanghai'),
    '2026-07-15 23:11:00 GMT+8',
  );
});

test('邮箱导入令牌只接受完整的 32 位十六进制格式', () => {
  assert.equal(
    emailImport.extractEmailImportToken('[AI-IMPORT 0123456789abcdef0123456789abcdef] 测试'),
    '0123456789abcdef0123456789abcdef',
  );
  assert.equal(emailImport.extractEmailImportToken('[AI-IMPORT short-token] 测试'), null);
});

test('日历按用户隔离并自动迁移默认日历', () => {
  const own = schedules.getAllCalendars(userId);
  const other = schedules.getAllCalendars('other-user');
  assert.ok(own.length >= 3);
  assert.ok(own.every(item => item.user_id === userId));
  assert.ok(other.every(item => item.user_id === 'other-user'));
  assert.equal(own.some(item => other.some(candidate => candidate.id === item.id)), false);
});

test('AI 会话和消息按用户隔离', () => {
  const otherUserId = 'other-session-user';
  db.createUser({
    id: otherUserId,
    email: 'other-session@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const now = new Date().toISOString();
  db.createSession({ id: 'session-user-a', user_id: userId, title: '用户 A', model: 'test', sdk_session_id: null, created_at: now, updated_at: now });
  db.createSession({ id: 'session-user-b', user_id: otherUserId, title: '用户 B', model: 'test', sdk_session_id: null, created_at: now, updated_at: now });
  db.createMessage({ id: 'message-user-a', session_id: 'session-user-a', role: 'user', content: 'A 私有消息', model: null, created_at: now, tool_calls: null }, userId);

  assert.equal(db.getAllSessions(userId).some(item => item.id === 'session-user-b'), false);
  assert.equal(db.getSession('session-user-b', userId), undefined);
  assert.equal(db.getMessagesBySession('session-user-a', otherUserId).length, 0);
  assert.throws(
    () => db.createMessage({ id: 'message-cross-user', session_id: 'session-user-a', role: 'user', content: '越权', model: null, created_at: now, tool_calls: null }, otherUserId),
    /无权访问/,
  );
});

test('AI 助手历史按用户隔离并逐条清理超过三天的记录', () => {
  const now = Date.now();
  const oldTime = new Date(now - 3 * 24 * 60 * 60 * 1000 - 1).toISOString();
  const freshTime = new Date(now).toISOString();
  db.createAiScheduleMessage({
    id: 'ai-history-old', user_id: userId, role: 'user', type: 'text', content: '旧消息',
    intent: null, schedule_items: null, plan: null, created_at: oldTime,
  });
  db.createAiScheduleMessage({
    id: 'ai-history-fresh', user_id: userId, role: 'assistant', type: 'text', content: '新消息',
    intent: 'chat', schedule_items: '[]', plan: null, created_at: freshTime,
  });
  db.createAiScheduleMessage({
    id: 'ai-history-other-user', user_id: 'other-session-user', role: 'user', type: 'text', content: '其他用户消息',
    intent: null, schedule_items: null, plan: null, created_at: oldTime,
  });

  const deleted = db.deleteExpiredAiScheduleMessages(new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(), userId);
  assert.equal(deleted, 1);
  assert.equal(db.getAiScheduleMessages(userId, 0).some(item => item.id === 'ai-history-old'), false);
  assert.equal(db.getAiScheduleMessages(userId, 0).some(item => item.id === 'ai-history-fresh'), true);
  assert.equal(db.getAiScheduleMessages('other-session-user', 0).some(item => item.id === 'ai-history-other-user'), true);
});

test('通用周期任务、逾期手动完成和下一周期生成', () => {
  const upcomingDueDate = reminders.addDays(reminders.todayInTimezone(), 1);
  const task = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '测试房租',
    config: {
      templateKey: 'rent',
      rule: {
        frequency: 'monthly',
        anchorDate: upcomingDueDate,
        dayOfMonth: Number(upcomingDueDate.slice(8, 10)),
        interval: 1,
        advancePolicy: 'calendar',
      },
      reminderOffsets: [3, 1, 0],
      reminderTime: '09:00',
      actionGuide: '支付房租',
      priority: 'high',
    },
  });
  assert.ok(task.currentCycle);
  const linked = reminderCalendarSync.syncReminderTaskToCalendar(task);
  assert.equal(linked?.all_day, true);
  assert.equal(linked?.type, 'todo');
  assert.equal(linked?.start_time.slice(0, 10), task.currentCycle?.dueDate);
  assert.equal(actionCenter.getActionCenter(userId, 14).today.some(item => item.sourceId === linked?.id), false);
  const firstCycle = task.currentCycle!;
  const completed = reminders.completeReminderCycle(task.id, userId, task.currentCycle!.id, task.currentCycle!.dueDate, '已支付');
  assert.equal(completed?.currentCycle?.status, 'pending');
  assert.notEqual(completed?.currentCycle?.id, task.currentCycle?.id);
  const completedCycle = reminders.getReminderHistory(task.id, userId).find(cycle => cycle.id === firstCycle.id)!;
  reminderCalendarSync.syncReminderCycleToCalendar(completed!, completedCycle);
  reminderCalendarSync.syncReminderTaskToCalendar(completed!);
  assert.equal(schedules.getSchedule(reminderCalendarSync.reminderScheduleId(firstCycle.id))?.is_completed, true);
  assert.ok(schedules.getSchedule(reminderCalendarSync.reminderScheduleId(completed!.currentCycle!.id)));
  const expiredTask = reminders.createReminderTask({
    userId,
    type: 'generic',
    name: '过期证件',
    config: {
      templateKey: 'document',
      rule: { frequency: 'once', anchorDate: '2020-01-01', advancePolicy: 'calendar' },
      reminderOffsets: [7, 1],
      reminderTime: '09:00',
      actionGuide: '补办证件',
      priority: 'high',
    },
  });
  assert.equal(expiredTask.currentCycle?.status, 'expired');
  const expiredCycleId = expiredTask.currentCycle!.id;
  reminders.completeReminderCycle(expiredTask.id, userId, expiredCycleId, reminders.todayInTimezone(), '逾期后补办');
  activity.createCompletion({ userId, sourceType: 'reminder', sourceId: expiredTask.id, instanceId: expiredCycleId, note: '逾期后手动完成' });
  assert.ok(actionCenter.getActionCenter(userId, 7).completedToday.some(item => item.instanceId === expiredCycleId));
});

test('行动中心聚合待办并记录完成证明', () => {
  const today = reminders.todayInTimezone();
  const schedule = schedules.createSchedule({
    id: 'schedule-one', user_id: userId, calendar_id: 'personal', type: 'todo', title: '测试待办',
    description: undefined, start_time: today + 'T09:00:00', end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'other', priority: 'high', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const center = actionCenter.getActionCenter(userId, 7);
  assert.ok(center.today.some(item => item.sourceId === schedule.id));
  const tomorrowSchedule = schedules.createSchedule({
    id: 'schedule-tomorrow', user_id: userId, calendar_id: 'personal', type: 'event', title: '明天的会议',
    description: undefined, start_time: reminders.addDays(today, 1) + 'T10:00:00', end_time: reminders.addDays(today, 1) + 'T11:00:00',
    all_day: false, location: undefined, notes: undefined, category: 'work', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const withTomorrow = actionCenter.getActionCenter(userId, 7);
  assert.ok(withTomorrow.tomorrow.some(item => item.sourceId === tomorrowSchedule.id));
  assert.ok(withTomorrow.upcoming.some(item => item.sourceId === tomorrowSchedule.id));
  const completion = activity.createCompletion({ userId, sourceType: 'schedule', sourceId: schedule.id, note: '完成证明' });
  schedules.updateSchedule(schedule.id, { is_completed: true });
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const file = attachments.saveBase64Attachment({ userId, completionId: completion.id, originalName: 'proof.png', mimeType: 'image/png', base64: pngHeader.toString('base64') });
  assert.equal(attachments.readAttachment(file).equals(pngHeader), true);
  assert.equal(activity.listAttachments(userId, completion.id).length, 1);
  assert.equal(activity.getAttachment(file.id, 'other-user'), null);
  const updated = activity.updateCompletion(completion.id, userId, { note: '更新后的证明，金额 123.45 元' });
  assert.equal(updated?.note, '更新后的证明，金额 123.45 元');
});

test('无日期待办只出现在行动中心的挂起区域', () => {
  const today = reminders.todayInTimezone();
  const suspended = schedules.createSchedule({
    id: 'schedule-suspended-todo', user_id: userId, calendar_id: 'personal', type: 'todo', title: '长期挂起事项',
    description: undefined, start_time: today + 'T00:00:00', end_time: undefined,
    all_day: false, is_unscheduled: true, location: undefined, notes: '想到时再处理', category: 'other', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const center = actionCenter.getActionCenter(userId, 7);
  assert.ok(center.unscheduled.some(item => item.sourceId === suspended.id));
  assert.equal(center.today.some(item => item.sourceId === suspended.id), false);
  assert.equal(schedules.getSchedulesByDate(today, userId).some(item => item.id === suspended.id), false);
});

test('日程分类只保留六个统一分类，未知值归入其他', () => {
  const schedule = schedules.createSchedule({
    id: 'schedule-legacy-category', user_id: userId, calendar_id: 'personal', type: 'event', title: '旧分类日程',
    description: undefined, start_time: reminders.todayInTimezone() + 'T12:00:00', end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'personal', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  assert.equal(schedule.category, 'other');
});

test('日历取消完成会同步行动中心，全天事项保留全天语义和备注', () => {
  const today = reminders.todayInTimezone();
  const schedule = schedules.createSchedule({
    id: 'schedule-all-day-undo', user_id: userId, calendar_id: 'personal', type: 'todo', title: '全天回退测试',
    description: undefined, start_time: `${today}T00:00:00`, end_time: `${today}T23:59:59`,
    all_day: true, location: undefined, notes: '携带账单原件', category: 'other', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });

  const before = actionCenter.getActionCenter(userId, 7).today.find(item => item.sourceId === schedule.id);
  assert.equal(before?.allDay, true);
  assert.equal(before?.nextAction, '携带账单原件');

  assert.equal(scheduleCompletion.toggleScheduleCompletion(schedule.id, userId)?.is_completed, true);
  assert.ok(actionCenter.getActionCenter(userId, 7).completedToday.some(item => item.sourceId === schedule.id));

  assert.equal(scheduleCompletion.toggleScheduleCompletion(schedule.id, userId)?.is_completed, false);
  const reopened = actionCenter.getActionCenter(userId, 7);
  assert.equal(reopened.completedToday.some(item => item.sourceId === schedule.id), false);
  assert.ok(reopened.today.some(item => item.sourceId === schedule.id));
});

test('通知队列幂等且可重试', () => {
  const input = { userId, sourceType: 'test', sourceId: 'one', channel: 'in_app' as const, kind: 'test', title: '测试通知', body: '内容', scheduledAt: new Date().toISOString(), dedupeKey: 'test:one' };
  const first = activity.enqueueNotification(input);
  const second = activity.enqueueNotification(input);
  assert.equal(first.id, second.id);
  assert.equal(activity.claimNotification(first.id), true);
  activity.markNotificationFailed(first.id, 'temporary');
  const failed = activity.getNotification(first.id);
  assert.equal(failed?.attempts, 1);
  assert.ok(failed?.nextRetryAt);
  assert.equal(activity.retryNotification(first.id, userId)?.status, 'pending');
});

test('用户加密备份可检查并合并恢复', () => {
  const password = 'test-password-123';
  const encrypted = backups.createUserBackup(userId, password);
  const preview = backups.inspectUserBackup(encrypted, password) as any;
  assert.ok(preview.counts.schedules >= 1);
  assert.ok(preview.counts.attachments >= 1);
  assert.throws(() => backups.inspectUserBackup(encrypted, 'wrong-password'), /密码错误|损坏/);
  const damaged = Buffer.from(encrypted);
  damaged[damaged.length - 1] ^= 0xff;
  assert.throws(() => backups.inspectUserBackup(damaged, password), /密码错误|损坏/);
  const restored = backups.restoreUserBackup(userId, encrypted, password, 'merge') as any;
  assert.equal(restored.mode, 'merge');
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
