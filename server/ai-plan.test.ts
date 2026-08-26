import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAiPlanSnapshot,
  normaliseAiPlanOperations,
  rawOperationsFromSnapshot,
  updateAiPlanOperation,
} from './ai-plan.js';

test('待确认计划为每个操作生成稳定编号并可编辑白名单字段', () => {
  const [operation] = normaliseAiPlanOperations([{
    type: 'create',
    data: {
      title: '整理资料',
      start_time: '2026-08-27T09:00:00',
      end_time: '2026-08-27T10:00:00',
      type: 'event',
    },
  }]);

  const updated = updateAiPlanOperation(operation, {
    title: '整理季度资料',
    startTime: '2026-08-27T10:30:00',
    endTime: '2026-08-27T11:30:00',
    location: '书房',
  });

  assert.equal(operation.key, '0');
  assert.equal(updated.key, '0');
  assert.equal(updated.data.title, '整理季度资料');
  assert.equal(updated.data.start_time, '2026-08-27T10:30:00');
  assert.equal(updated.data.end_time, '2026-08-27T11:30:00');
  assert.equal(updated.data.location, '书房');
  assert.throws(() => updateAiPlanOperation(operation, { category: 'work' }), /不允许编辑/);
});

test('无固定期限待办编辑时强制保持 todo 且清除结束时间', () => {
  const [operation] = normaliseAiPlanOperations([{
    type: 'create',
    data: {
      title: '长期待办',
      start_time: '2026-08-27T09:00:00',
      end_time: '2026-08-27T10:00:00',
      type: 'event',
      is_unscheduled: false,
    },
  }]);
  const updated = updateAiPlanOperation(operation, { isUnscheduled: true });
  assert.equal(updated.data.type, 'todo');
  assert.equal(updated.data.end_time, null);
  assert.equal(updated.data.all_day, false);
});

test('周期计划只允许编辑标题、起始日期、提醒时间和操作说明', () => {
  const [operation] = normaliseAiPlanOperations([{
    type: 'create_recurring',
    data: { title: '检查设备', notes: '记录结果' },
    recurrence: { frequency: 'interval', interval: 1, unit: 'month', anchorDate: '2026-08-27', reminderTime: '09:00' },
  }]);
  const updated = updateAiPlanOperation(operation, {
    title: '检查设备并记录',
    anchorDate: '2026-09-01',
    reminderTime: '10:30',
    actionGuide: '完成后登记结果',
  });
  assert.equal(updated.data.title, '检查设备并记录');
  assert.equal(updated.data.notes, '完成后登记结果');
  assert.equal(updated.recurrence?.anchorDate, '2026-09-01');
  assert.equal(updated.recurrence?.reminderTime, '10:30');
  assert.throws(() => updateAiPlanOperation(operation, { startTime: '2026-09-01T09:00:00' }), /不允许编辑/);
});

test('计划快照可从历史记录恢复原始操作', () => {
  const [operation] = normaliseAiPlanOperations([{ type: 'delete', scheduleId: 'schedule-1', data: {} }]);
  const snapshot = buildAiPlanSnapshot({
    id: 'plan-1',
    expiresAt: Date.now() + 60_000,
    warnings: [],
    targetCalendarId: 'personal',
    today: '2026-08-27',
    intent: 'delete',
    reply: '请确认',
    operations: [operation],
  });
  const restored = rawOperationsFromSnapshot(snapshot);
  assert.deepEqual(restored[0], operation);
});
