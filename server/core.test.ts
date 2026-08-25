import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CreditCardConfig, GenericReminderConfig, SimConfig } from './reminder-store.js';

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
const dailyReportTokens = await import('./daily-report-token-service.js');

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

test('同一时刻按用户时区计算各自的本地日期', () => {
  const instant = new Date('2026-08-24T16:30:00.000Z');
  assert.equal(reminders.todayInTimezone('Asia/Shanghai', instant), '2026-08-25');
  assert.equal(reminders.todayInTimezone('America/Los_Angeles', instant), '2026-08-24');
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
      ...(task.config as GenericReminderConfig),
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
      ...(task.config as SimConfig),
      reminderOffsets: [3],
    },
  });

  assert.equal(firstNextDate, reminders.addDays(task.currentCycle!.dueDate, -10));
  assert.equal(updated?.nextReminderDate, reminders.addDays(task.currentCycle!.dueDate, -3));
  assert.notEqual(updated?.nextReminderDate, firstNextDate);
});

test('编辑信用卡日期会同步当前周期的账单日和还款日', () => {
  const task = reminders.createReminderTask({
    userId,
    type: 'credit_card',
    name: '信用卡日期编辑测试',
    config: {
      statementDay: 22,
      paymentDay: 20,
      paymentMonthOffset: 1,
      reminderOffsets: [7, 1, 0],
      reminderTime: '09:00',
      priority: 'high',
    },
  });
  const originalPeriodStart = task.currentCycle!.periodStart;
  const periodMonth = originalPeriodStart.slice(0, 7);
  const [year, month] = periodMonth.split('-').map(Number);
  const updated = reminders.updateReminderTask(task.id, userId, {
    config: {
      ...(task.config as CreditCardConfig),
      statementDay: 5,
      paymentDay: 28,
      paymentMonthOffset: 0,
    },
  });

  assert.equal(updated?.currentCycle?.periodStart, `${periodMonth}-05`);
  assert.equal(updated?.currentCycle?.dueDate, `${year}-${String(month).padStart(2, '0')}-28`);
  assert.notEqual(updated?.currentCycle?.periodStart, originalPeriodStart);
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

test('邮箱验证码以带密钥摘要保存并仍可正常校验', () => {
  const now = new Date();
  db.createEmailCode({
    id: 'email-code-hash-test',
    email: 'test@example.com',
    code: '123456',
    purpose: 'register',
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    created_at: now.toISOString(),
  });
  const verified = db.verifyEmailCode('test@example.com', '123456', 'register');
  assert.ok(verified);
  assert.notEqual(verified?.code, '123456');
  assert.equal(db.verifyEmailCode('test@example.com', '000000', 'register'), undefined);
});

test('日报令牌只保存哈希，可轮换、撤销并按账号隔离', () => {
  const generated = dailyReportTokens.generateDailyReportToken(userId);
  assert.match(generated.token, /^drr_/);
  const stored = db.getDailyReportToken(userId)!;
  assert.notEqual(stored.token_hash, generated.token);
  assert.equal(stored.token_hash, dailyReportTokens.hashDailyReportToken(generated.token));
  assert.deepEqual(dailyReportTokens.authenticateDailyReportToken(generated.token), { userId });

  const rotated = dailyReportTokens.generateDailyReportToken(userId);
  assert.notEqual(rotated.token, generated.token);
  assert.equal(dailyReportTokens.authenticateDailyReportToken(generated.token), null);
  assert.deepEqual(dailyReportTokens.authenticateDailyReportToken(rotated.token), { userId });

  dailyReportTokens.revokeDailyReportToken(userId);
  assert.equal(dailyReportTokens.authenticateDailyReportToken(rotated.token), null);
  assert.equal(dailyReportTokens.getDailyReportTokenStatus(userId).active, false);
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

test('完成证明拒绝非法金额、日期和过长备注', () => {
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    amountCents: -1,
  }), /金额/);
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    billDate: '2026-99-99',
  }), /账单日期/);
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    billDate: '2026-02-31',
  }), /账单日期/);
  assert.throws(() => activity.createCompletion({
    userId,
    sourceType: 'schedule',
    sourceId: 'invalid-completion',
    note: 'x'.repeat(10_001),
  }), /完成备注/);
});

test('行动中心显示未完成的历史待办，并按用户时区识别带偏移量的今天', () => {
  const today = reminders.todayInTimezone();
  const overdue = schedules.createSchedule({
    id: 'schedule-overdue-action-center', user_id: userId, calendar_id: 'personal', type: 'todo', title: '历史逾期待办',
    description: undefined, start_time: reminders.addDays(today, -2) + 'T09:00:00', end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'other', priority: 'high', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const overdueEvent = schedules.createSchedule({
    id: 'schedule-overdue-event-action-center', user_id: userId, calendar_id: 'personal', type: 'event', title: '历史逾期日程',
    description: undefined, start_time: reminders.addDays(today, -2) + 'T10:00:00', end_time: reminders.addDays(today, -2) + 'T11:00:00',
    all_day: false, location: undefined, notes: undefined, category: 'work', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  const staleCompletionEvent = schedules.createSchedule({
    id: 'schedule-stale-completion-event-action-center', user_id: userId, calendar_id: 'personal', type: 'event', title: '带历史完成脏记录的逾期日程',
    description: undefined, start_time: reminders.addDays(today, -3) + 'T12:00:00', end_time: reminders.addDays(today, -3) + 'T13:00:00',
    all_day: false, location: undefined, notes: undefined, category: 'work', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  activity.createCompletion({ userId, sourceType: 'schedule', sourceId: staleCompletionEvent.id, note: '遗留完成记录' });
  const todayWithOffset = new Date(`${today}T00:30:00+08:00`).toISOString();
  const todaySchedule = schedules.createSchedule({
    id: 'schedule-today-offset-action-center', user_id: userId, calendar_id: 'personal', type: 'todo', title: '带偏移量的今天待办',
    description: undefined, start_time: todayWithOffset, end_time: undefined,
    all_day: false, location: undefined, notes: undefined, category: 'other', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });

  const center = actionCenter.getActionCenter(userId, 7);
  assert.ok(center.overdue.some(item => item.sourceId === overdue.id));
  assert.ok(center.overdue.some(item => item.sourceId === overdueEvent.id));
  assert.ok(center.overdue.some(item => item.sourceId === staleCompletionEvent.id));
  assert.equal(center.overdue.find(item => item.sourceId === staleCompletionEvent.id)?.completionId, null);
  assert.ok(center.today.some(item => item.sourceId === todaySchedule.id));
  assert.equal(center.overdue.some(item => item.sourceId === todaySchedule.id), false);
});

test('无日期待办只出现在行动中心的挂起区域', () => {
  const today = reminders.todayInTimezone();
  const suspended = schedules.createSchedule({
    id: 'schedule-suspended-todo', user_id: userId, calendar_id: 'personal', type: 'todo', title: '长期挂起事项',
    description: undefined, start_time: today + 'T00:00:00', end_time: undefined,
    all_day: false, is_unscheduled: true, location: undefined, notes: '想到时再处理', category: 'other', priority: 'medium', is_completed: false,
    is_repeated: false, repeat_rule: undefined, reminders: [], is_high_risk: false,
  });
  assert.equal(suspended.end_time, undefined);
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

test('跨账号恢复会重映射关联 ID，替换恢复会清理旧附件文件', () => {
  const targetUserId = 'other-session-user';
  const password = 'cross-account-password';
  const sourceScheduleIds = new Set(schedules.getAllSchedules(userId).map(item => item.id));
  const encrypted = backups.createUserBackup(userId, password);
  const merged = backups.restoreUserBackup(targetUserId, encrypted, password, 'merge') as any;
  assert.equal(merged.idsRemapped, true);
  const targetSchedules = schedules.getAllSchedules(targetUserId);
  assert.ok(targetSchedules.length > 0);
  assert.equal(targetSchedules.some(item => sourceScheduleIds.has(item.id)), false);

  const completion = activity.createCompletion({
    userId: targetUserId,
    sourceType: 'schedule',
    sourceId: targetSchedules[0].id,
    note: '等待替换恢复清理',
  });
  const uniquePdf = Buffer.from('%PDF-1.4\nunique-target-attachment\n%%EOF', 'utf8');
  const orphan = attachments.saveBase64Attachment({
    userId: targetUserId,
    completionId: completion.id,
    originalName: 'old-proof.pdf',
    mimeType: 'application/pdf',
    base64: uniquePdf.toString('base64'),
  });
  const orphanPath = path.join(tempDir, orphan.storagePath);
  assert.equal(fs.existsSync(orphanPath), true);

  const replaced = backups.restoreUserBackup(targetUserId, encrypted, password, 'replace') as any;
  assert.equal(replaced.idsRemapped, true);
  assert.equal(fs.existsSync(orphanPath), false);
  assert.equal(activity.getAttachment(orphan.id, targetUserId), null);
});

test('全站恢复统一替换四个数据库和附件且不遗留暂存文件', () => {
  const previousKey = process.env.BACKUP_ENCRYPTION_KEY;
  const previousMaintenance = process.env.MAINTENANCE_MODE;
  process.env.BACKUP_ENCRYPTION_KEY = 'system-restore-test-password';
  process.env.MAINTENANCE_MODE = 'true';
  try {
    const attachmentRoot = attachments.attachmentsRoot();
    const originalAttachment = path.join(attachmentRoot, 'system-restore-test', 'proof.txt');
    fs.mkdirSync(path.dirname(originalAttachment), { recursive: true });
    fs.writeFileSync(originalAttachment, 'original attachment', 'utf8');
    const snapshot = backups.createSystemSnapshot(false);
    const encrypted = backups.readSystemSnapshot(snapshot.filename);
    const databaseNames = ['chat.db', 'schedule.db', 'reminder.db', 'activity.db'];
    const expectedHashes = new Map(databaseNames.map(name => [
      name,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(tempDir, name))).digest('hex'),
    ]));

    for (const name of databaseNames) fs.appendFileSync(path.join(tempDir, name), 'changed-after-snapshot');
    fs.writeFileSync(originalAttachment, 'changed attachment', 'utf8');
    fs.writeFileSync(path.join(attachmentRoot, 'extra.txt'), 'remove me', 'utf8');

    backups.restoreSystemSnapshot(encrypted, 'RESTORE AI CALENDAR');

    for (const name of databaseNames) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(tempDir, name))).digest('hex');
      assert.equal(actual, expectedHashes.get(name));
    }
    assert.equal(fs.readFileSync(originalAttachment, 'utf8'), 'original attachment');
    assert.equal(fs.existsSync(path.join(attachmentRoot, 'extra.txt')), false);
    assert.equal(fs.readdirSync(tempDir).some(name => name.includes('.restore-') || name.includes('.pre-restore-')), false);
  } finally {
    if (previousKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previousKey;
    if (previousMaintenance === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = previousMaintenance;
  }
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
