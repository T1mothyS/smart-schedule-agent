export type AiPlanOperationType = 'create' | 'create_recurring' | 'update' | 'delete';

export interface PendingAiOperation {
  key: string;
  type: AiPlanOperationType;
  scheduleId?: string;
  data: Record<string, any>;
  recurrence?: Record<string, any> | null;
}

export interface AiPlanOperationPreview {
  key: string;
  type: AiPlanOperationType;
  scheduleType: 'event' | 'todo';
  scheduleId?: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  isUnscheduled: boolean;
  location: string | null;
  notes: string | null;
  recurrence: {
    frequency: string;
    interval: number;
    unit: string;
    anchorDate: string | null;
    reminderOffsets: number[];
    reminderTime: string;
  } | null;
}

const OPERATION_TYPES = new Set<AiPlanOperationType>(['create', 'create_recurring', 'update', 'delete']);
const SCHEDULE_TYPES = new Set(['event', 'todo']);

function text(value: unknown, label: string, maxLength: number, allowEmpty = true): string {
  const result = String(value ?? '').trim();
  if (!allowEmpty && !result) throw new Error(`${label}不能为空`);
  if (result.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return result;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function normaliseDateTime(value: unknown, label: string): string {
  const result = text(value, label, 64, false);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || Number.isNaN(Date.parse(result))) {
    throw new Error(`${label}格式不正确`);
  }
  return result;
}

function cloneOperation(operation: any, index: number): PendingAiOperation {
  const type = operation?.type as AiPlanOperationType;
  if (!OPERATION_TYPES.has(type)) throw new Error('计划操作类型不正确');
  const data = operation?.data && typeof operation.data === 'object' && !Array.isArray(operation.data)
    ? { ...operation.data }
    : {};
  return {
    ...operation,
    key: String(index),
    type,
    scheduleId: operation?.scheduleId == null ? undefined : String(operation.scheduleId),
    data,
    recurrence: operation?.recurrence && typeof operation.recurrence === 'object'
      ? { ...operation.recurrence }
      : null,
  };
}

export function normaliseAiPlanOperations(input: unknown): PendingAiOperation[] {
  if (!Array.isArray(input)) return [];
  return input.map((operation, index) => cloneOperation(operation, index));
}

export function previewAiPlanOperation(operation: PendingAiOperation, index = Number(operation.key)): AiPlanOperationPreview {
  const data = operation.data || {};
  const recurrence = operation.recurrence || data.recurrence;
  return {
    key: operation.key || String(index),
    type: operation.type,
    scheduleType: data.type === 'todo' ? 'todo' : 'event',
    scheduleId: operation.scheduleId,
    title: text(data.title || (operation as any).title, '标题', 160) || '未命名事项',
    startTime: data.start_time == null ? null : String(data.start_time),
    endTime: data.end_time == null ? null : String(data.end_time),
    allDay: data.all_day === true,
    isUnscheduled: data.is_unscheduled === true,
    location: data.location == null ? null : String(data.location),
    notes: data.notes == null ? null : String(data.notes),
    recurrence: recurrence ? {
      frequency: String(recurrence.frequency || 'interval'),
      interval: Number(recurrence.interval || 1),
      unit: String(recurrence.unit || 'day'),
      anchorDate: recurrence.anchorDate || String(data.start_time || '').slice(0, 10) || null,
      reminderOffsets: Array.isArray(recurrence.reminderOffsets) ? recurrence.reminderOffsets.map(Number) : [1, 0],
      reminderTime: String(recurrence.reminderTime || '09:00'),
    } : null,
  };
}

export function updateAiPlanOperation(operation: PendingAiOperation, patch: Record<string, unknown>): PendingAiOperation {
  const allowed = operation.type === 'create_recurring'
    ? new Set(['title', 'anchorDate', 'reminderTime', 'actionGuide'])
    : new Set(['type', 'title', 'startTime', 'endTime', 'allDay', 'isUnscheduled', 'location', 'notes']);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error(`字段 ${key} 不允许编辑`);
  }
  if (operation.type === 'delete') throw new Error('删除计划不能编辑，请取消计划后重新描述');

  const next: PendingAiOperation = {
    ...operation,
    data: { ...operation.data },
    recurrence: operation.recurrence ? { ...operation.recurrence } : null,
  };

  if (operation.type === 'create_recurring') {
    if (patch.title !== undefined) next.data.title = text(patch.title, '标题', 160, false);
    if (patch.actionGuide !== undefined) next.data.notes = text(patch.actionGuide, '操作说明', 10_000);
    if (patch.anchorDate !== undefined) {
      if (!validDate(patch.anchorDate)) throw new Error('起始日期格式不正确');
      next.recurrence = { ...(next.recurrence || {}), anchorDate: patch.anchorDate };
      next.data.start_time = `${patch.anchorDate}T00:00:00`;
    }
    if (patch.reminderTime !== undefined) {
      if (!validTime(patch.reminderTime)) throw new Error('提醒时间格式不正确');
      next.recurrence = { ...(next.recurrence || {}), reminderTime: patch.reminderTime };
    }
    return next;
  }

  if (patch.type !== undefined) {
    if (!SCHEDULE_TYPES.has(String(patch.type))) throw new Error('日程类型不正确');
    next.data.type = patch.type;
  }
  if (patch.title !== undefined) next.data.title = text(patch.title, '标题', 160, false);
  if (patch.startTime !== undefined) next.data.start_time = normaliseDateTime(patch.startTime, '开始时间');
  if (patch.endTime !== undefined) {
    next.data.end_time = patch.endTime == null || patch.endTime === '' ? null : normaliseDateTime(patch.endTime, '结束时间');
  }
  if (patch.allDay !== undefined) {
    if (typeof patch.allDay !== 'boolean') throw new Error('全天字段不正确');
    next.data.all_day = patch.allDay;
  }
  if (patch.isUnscheduled !== undefined) {
    if (typeof patch.isUnscheduled !== 'boolean') throw new Error('无固定期限字段不正确');
    next.data.is_unscheduled = patch.isUnscheduled;
  }
  if (patch.location !== undefined) next.data.location = text(patch.location, '地点', 500) || null;
  if (patch.notes !== undefined) next.data.notes = text(patch.notes, '备注', 10_000) || null;

  if (next.data.is_unscheduled === true) {
    next.data.type = 'todo';
    next.data.all_day = false;
    next.data.end_time = null;
  } else if (next.data.type === 'todo') {
    next.data.end_time = null;
  } else if (next.data.all_day === true) {
    next.data.end_time = null;
  } else if (next.data.start_time && next.data.end_time && Date.parse(next.data.end_time) < Date.parse(next.data.start_time)) {
    throw new Error('结束时间不能早于开始时间');
  }
  return next;
}

export function buildAiPlanSnapshot(input: {
  id: string;
  expiresAt: number;
  warnings: string[];
  targetCalendarId: string;
  today: string;
  intent: string;
  reply: string;
  operations: PendingAiOperation[];
  historyMessageId?: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    expiresAt: new Date(input.expiresAt).toISOString(),
    warnings: input.warnings,
    targetCalendarId: input.targetCalendarId,
    today: input.today,
    intent: input.intent,
    reply: input.reply,
    operations: input.operations.map(operation => previewAiPlanOperation(operation)),
    rawOperations: input.operations,
    historyMessageId: input.historyMessageId,
  };
}

export function rawOperationsFromSnapshot(snapshot: any): PendingAiOperation[] {
  if (Array.isArray(snapshot?.rawOperations)) return normaliseAiPlanOperations(snapshot.rawOperations);
  return [];
}
