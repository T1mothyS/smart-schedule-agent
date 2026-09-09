import { useState, useRef, useCallback, useEffect } from 'react';
import { Bot, Send, Loader2, CheckCircle2, Edit3, Eye, EyeOff, MapPin, Clock, RotateCcw, Save, X, StickyNote } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { SCHEDULE_CATEGORY_COLORS, SCHEDULE_CATEGORY_LABELS } from '../utils/scheduleCategories';
import { NoteBoard, type NoteItem } from './NoteBoard';

// ==================== 类型 ====================

interface Schedule {
  id: string;
  calendar_id: string;
  type: 'event' | 'todo';
  title: string;
  start_time: string;
  end_time?: string;
  all_day: boolean;
  is_unscheduled?: boolean;
  location?: string;
  notes?: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  is_completed: boolean;
}

interface AiPlanOperation {
  key: string;
  type: 'create' | 'create_recurring' | 'update' | 'delete';
  scheduleId?: string;
  scheduleType?: 'event' | 'todo';
  title: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  isUnscheduled?: boolean;
  location?: string | null;
  notes?: string | null;
  recurrence?: {
    frequency: string;
    interval: number;
    unit: string;
    anchorDate?: string | null;
    reminderOffsets?: number[];
    reminderTime?: string;
  } | null;
}

interface AiSchedulePlan {
  id: string;
  expiresAt: string;
  warnings: string[];
  operations: AiPlanOperation[];
}

type MessageRole = 'user' | 'assistant';
type MessageType = 'text' | 'schedules' | 'update' | 'plan' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  type: MessageType;
  text?: string;
  intent?: string;
  scheduleItems?: Schedule[];
  plan?: AiSchedulePlan;
  timestamp: string;
}

interface AiSchedulePanelProps {
  onSchedulesCreated?: (schedules: Schedule[]) => void;
  onOpenSchedule?: (id: string) => void;
  onOpenScheduleMenu?: (id: string, x: number, y: number) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  initialNoteId?: string;
}

// ==================== 常量 ====================

const CATEGORY_COLORS = SCHEDULE_CATEGORY_COLORS;
const CATEGORY_LABELS = SCHEDULE_CATEGORY_LABELS;

const PRIORITY_COLORS: Record<string, string> = {
  high: '#EF4444', medium: '#F59E0B', low: '#10B981',
};

const AI_RESPONSE_TIMEOUT_MS = 330_000;
const AI_RETRY_WINDOW_MS = 15 * 60 * 1000;

interface PlanOperationForm {
  title: string;
  type: 'event' | 'todo';
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  isUnscheduled: boolean;
  location: string;
  notes: string;
  anchorDate: string;
  reminderTime: string;
  actionGuide: string;
}

function datePart(value?: string | null): string {
  return value?.slice(0, 10) || '';
}

function timePart(value?: string | null): string {
  return value?.slice(11, 16) || '';
}

function operationToForm(operation: AiPlanOperation): PlanOperationForm {
  return {
    title: operation.title || '',
    type: operation.scheduleType || (operation.isUnscheduled ? 'todo' : 'event'),
    startDate: datePart(operation.startTime),
    startTime: timePart(operation.startTime) || '09:00',
    endDate: datePart(operation.endTime) || datePart(operation.startTime),
    endTime: timePart(operation.endTime),
    allDay: operation.allDay === true,
    isUnscheduled: operation.isUnscheduled === true,
    location: operation.location || '',
    notes: operation.notes || '',
    anchorDate: operation.recurrence?.anchorDate || datePart(operation.startTime),
    reminderTime: operation.recurrence?.reminderTime || '12:00',
    actionGuide: operation.notes || '',
  };
}

function PlanOperationCard({ operation, editing, saving, onStartEdit, onCancel, onSave }: {
  operation: AiPlanOperation;
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState<PlanOperationForm>(() => operationToForm(operation));

  useEffect(() => {
    setForm(operationToForm(operation));
  }, [operation]);

  const update = <K extends keyof PlanOperationForm>(key: K, value: PlanOperationForm[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!form.title.trim()) return window.alert('标题不能为空');
    try {
      if (operation.type === 'create_recurring') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.anchorDate)) return window.alert('请填写有效的起始日期');
        if (!/^\d{2}:\d{2}$/.test(form.reminderTime)) return window.alert('请填写有效的提醒时间');
        await onSave({ title: form.title.trim(), anchorDate: form.anchorDate, reminderTime: form.reminderTime, actionGuide: form.actionGuide });
        return;
      }
      if (!form.isUnscheduled && !/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) return window.alert('请填写有效的开始日期');
      const startTime = form.isUnscheduled ? undefined : `${form.startDate}T${form.allDay ? '00:00' : (form.startTime || '09:00')}:00`;
      const endTime = form.isUnscheduled || form.allDay || !form.endDate || !form.endTime
        ? ''
        : `${form.endDate}T${form.endTime}:00`;
      await onSave({
        type: form.isUnscheduled ? 'todo' : form.type,
        title: form.title.trim(),
        ...(startTime ? { startTime } : {}),
        endTime,
        allDay: form.isUnscheduled ? false : form.allDay,
        isUnscheduled: form.isUnscheduled,
        location: form.location,
        notes: form.notes,
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存计划项失败');
    }
  };

  const actionLabel: Record<string, string> = { create: '新建日程', create_recurring: '周期事项', update: '修改日程', delete: '删除日程' };
  const recurrenceUnit = operation.recurrence?.frequency === 'monthly' ? '月'
    : operation.recurrence?.frequency === 'yearly' ? '年'
      : operation.recurrence?.unit === 'month' ? '月'
        : operation.recurrence?.unit === 'year' ? '年' : '天';
  const timeLabel = operation.isUnscheduled
    ? '无具体日期 · 挂起待办'
    : operation.recurrence
      ? `每 ${operation.recurrence.interval || 1} ${recurrenceUnit} · 起始 ${operation.recurrence.anchorDate || '待确认'}`
      : operation.startTime ? `${formatDate(operation.startTime)} ${operation.allDay ? '全天' : formatTime(operation.startTime)}` : '时间待确认';
  const editable = operation.type !== 'delete';

  return <div
    className="rounded-md px-2 py-1.5"
    role={!editing && editable ? 'button' : undefined}
    tabIndex={!editing && editable ? 0 : undefined}
    onClick={() => { if (!editing && editable) onStartEdit(); }}
    onKeyDown={event => {
      if (!editing && editable && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onStartEdit();
      }
    }}
    style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid #DBEAFE', cursor: !editing && editable ? 'pointer' : undefined }}
  >
    {!editing ? <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{operation.title}</div>
        {operation.type !== 'delete' && <button type="button" className="ai-plan-edit-button" onClick={event => { event.stopPropagation(); onStartEdit(); }} aria-label={`编辑计划项 ${operation.title}`}><Edit3 size={13} /> 编辑</button>}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>{actionLabel[operation.type] || '处理'} · {timeLabel}</div>
      {operation.location && <div className="text-[11px] mt-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>地点：{operation.location}</div>}
      {operation.notes && <div className="text-[11px] mt-0.5 whitespace-pre-line" style={{ color: 'var(--td-text-color-secondary)' }}>备注：{operation.notes}</div>}
      {operation.type === 'delete' && <div className="text-[11px] mt-1" style={{ color: '#B45309' }}>删除计划不能编辑；如需调整，请取消后重新描述。</div>}
    </> : <div className="ai-plan-operation-editor">
      <div className="ai-plan-editor-head"><strong>编辑计划项</strong><button type="button" className="icon-button" onClick={onCancel} disabled={saving} aria-label="取消编辑"><X size={14} /></button></div>
      {operation.type === 'create_recurring' ? <>
        <label>标题<input value={form.title} onChange={event => update('title', event.target.value)} autoFocus /></label>
        <div className="ai-plan-editor-grid"><label>起始日期<input type="date" value={form.anchorDate} onChange={event => update('anchorDate', event.target.value)} /></label><label>提醒时间<input type="time" value={form.reminderTime} onChange={event => update('reminderTime', event.target.value)} /></label></div>
        <label>操作说明<textarea rows={2} value={form.actionGuide} onChange={event => update('actionGuide', event.target.value)} /></label>
      </> : <>
        <label>标题<input value={form.title} onChange={event => update('title', event.target.value)} autoFocus /></label>
        <label>类型<select value={form.type} onChange={event => update('type', event.target.value as PlanOperationForm['type'])} disabled={form.isUnscheduled}><option value="event">日程</option><option value="todo">待办</option></select></label>
        <div className="ai-plan-editor-grid"><label>开始日期<input type="date" value={form.startDate} onChange={event => update('startDate', event.target.value)} disabled={form.isUnscheduled} /></label><label>开始时间<input type="time" value={form.startTime} onChange={event => update('startTime', event.target.value)} disabled={form.isUnscheduled || form.allDay} /></label></div>
        <div className="ai-plan-editor-grid"><label>结束日期<input type="date" value={form.endDate} onChange={event => update('endDate', event.target.value)} disabled={form.isUnscheduled || form.allDay} /></label><label>结束时间<input type="time" value={form.endTime} onChange={event => update('endTime', event.target.value)} disabled={form.isUnscheduled || form.allDay} /></label></div>
        <div className="ai-plan-editor-checks"><label><input type="checkbox" checked={form.allDay} onChange={event => update('allDay', event.target.checked)} disabled={form.isUnscheduled} /> 全天</label><label><input type="checkbox" checked={form.isUnscheduled} onChange={event => update('isUnscheduled', event.target.checked)} /> 无固定期限待办</label></div>
        <label>地点<input value={form.location} onChange={event => update('location', event.target.value)} /></label>
        <label>备注<textarea rows={2} value={form.notes} onChange={event => update('notes', event.target.value)} /></label>
      </>}
      <div className="ai-plan-editor-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>取消</button><button type="button" className="primary-button" onClick={save} disabled={saving}><Save size={13} />{saving ? '保存中…' : '保存这项'}</button></div>
    </div>}
  </div>;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() || `ai_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function readJsonResponse(response: Response): Promise<any> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const contentType = response.headers.get('content-type') || '未知类型';
    const preview = raw.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`服务返回了非 JSON 内容（${contentType}）：${preview || '空响应'}。请检查代理超时或服务状态。`);
  }
}

// 【关键修复】获取本地时区的日期字符串（YYYY-MM-DD）
function getLocalDateString(date?: Date): string {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return isoStr; }
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return '今天';
    if (d.toDateString() === tomorrow.toDateString()) return '明天';
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  } catch { return isoStr.split('T')[0]; }
}

// ==================== 日程卡片 ====================

function ScheduleMiniCard({ schedule, onOpen, onOpenMenu }: {
  schedule: Schedule;
  onOpen?: (id: string) => void;
  onOpenMenu?: (id: string, x: number, y: number) => void;
}) {
  const color = CATEGORY_COLORS[schedule.category] || '#6B7280';
  const pColor = PRIORITY_COLORS[schedule.priority] || '#F59E0B';
  const dateStr = formatDate(schedule.start_time);
  const startStr = schedule.all_day ? '全天' : formatTime(schedule.start_time);
  const endStr = schedule.end_time && !schedule.all_day ? ` - ${formatTime(schedule.end_time)}` : '';

  return (
    <button
      type="button"
      className="ai-schedule-card w-full rounded-xl p-3 mb-2 text-left transition-all"
      style={{
        background: `linear-gradient(135deg, ${pColor}10, ${color}06)`,
        border: `1px solid ${pColor}30`,
        borderLeft: `3px solid ${pColor}`,
      }}
      onClick={() => onOpen?.(schedule.id)}
      onContextMenu={event => {
        event.preventDefault();
        onOpenMenu?.(schedule.id, event.clientX, event.clientY);
      }}
      onKeyDown={event => {
        if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu?.(schedule.id, rect.left + 24, rect.top + 24);
        }
      }}
      aria-label={`打开日程详情：${schedule.title}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <span
          className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {schedule.type === 'todo' ? '待办' : CATEGORY_LABELS[schedule.category] || '其他'}
        </span>
        <span className="schedule-title-primary truncate">
          {schedule.is_completed ? '已完成 · ' : ''}{schedule.title}
        </span>
      </div>

      <div className="flex items-center gap-3 min-w-0" style={{ color: 'var(--td-text-color-secondary)' }}>
        <span className="flex items-center gap-1 text-xs flex-shrink-0">
          <Clock className="w-3 h-3" />
          {dateStr} {startStr}{endStr}
        </span>
        {schedule.location && (
          <span className="flex items-center gap-1 text-xs truncate">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            {schedule.location}
          </span>
        )}
      </div>

      {schedule.notes && (
        <div className="mt-1.5 text-xs truncate" style={{ color: 'var(--td-text-color-secondary)' }}>
          备注：{schedule.notes}
        </div>
      )}
    </button>
  );
}

// ==================== 消息气泡 ====================

function MessageBubble({ msg, onOpenSchedule, onOpenScheduleMenu, onConfirmPlan, onDiscardPlan, onUpdatePlanOperation, confirmingPlanId, savingPlanOperationKey }: {
  msg: ChatMessage;
  onOpenSchedule?: (id: string) => void;
  onOpenScheduleMenu?: (id: string, x: number, y: number) => void;
  onConfirmPlan?: (messageId: string, planId: string) => void;
  onDiscardPlan?: (messageId: string) => void;
  onUpdatePlanOperation?: (planId: string, key: string, patch: Record<string, unknown>) => Promise<void>;
  confirmingPlanId?: string | null;
  savingPlanOperationKey?: string | null;
}) {
  const isUser = msg.role === 'user';
  const [editingOperationKey, setEditingOperationKey] = useState<string | null>(null);

  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div
          className="text-xs px-3 py-2 rounded-2xl rounded-tr-sm max-w-[88%] leading-relaxed whitespace-pre-line"
          style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
        >
          {msg.text}
        </div>
      </div>
    );
  }

  // AI 回复
  const intentLabel: Record<string, string> = {
    create: '创建', update: '修改', delete: '删除', query: '查询', chat: '对话', weather: '天气'
  };

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[96%] w-full">
        {/* AI 头像行 */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-xs"
            style={{ backgroundColor: 'var(--td-brand-color)' }}
          >
            <Bot className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
            AI 助手
            {msg.intent && msg.intent !== 'chat' && (
              <span className="ml-1">· {intentLabel[msg.intent] || ''}</span>
            )}
          </span>
        </div>

        {msg.type === 'error' ? (
          <div className="px-3 py-2 rounded-xl text-xs whitespace-pre-line" style={{ backgroundColor: '#FEF2F2', color: '#EF4444', border: '1px solid #FCA5A5' }}>
            {msg.text}
          </div>
        ) : (
          <div
            className="rounded-2xl rounded-tl-sm px-3 py-2.5"
            style={{ backgroundColor: 'var(--td-bg-color-page)', border: '1px solid var(--td-component-stroke)' }}
          >
            {/* 文字回复 */}
            {msg.text && (
              <div className="flex items-start gap-1.5 mb-2">
                {msg.type !== 'text' && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#10B981' }} />}
                <span
                  className={`text-xs leading-relaxed whitespace-pre-line ${msg.type === 'text' ? 'font-normal' : 'font-medium'}`}
                  style={{ color: msg.type === 'text' ? 'var(--td-text-color-primary)' : '#10B981' }}
                >
                  {msg.text}
                </span>
              </div>
            )}

            {msg.type === 'plan' && msg.plan && (
              <div className="mt-2 rounded-lg p-2.5" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                <div className="text-xs font-medium mb-2" style={{ color: '#1D4ED8' }}>待确认执行计划 · {msg.plan.operations.length} 项</div>
                {msg.plan.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="text-xs mb-1" style={{ color: '#B45309' }}>需核对：{warning}</div>
                ))}
                <div className="space-y-1.5">
                  {msg.plan.operations.map(operation => <PlanOperationCard
                    key={operation.key}
                    operation={operation}
                    editing={editingOperationKey === operation.key}
                    saving={savingPlanOperationKey === `${msg.plan!.id}:${operation.key}`}
                    onStartEdit={() => setEditingOperationKey(operation.key)}
                    onCancel={() => setEditingOperationKey(null)}
                    onSave={async patch => {
                      await onUpdatePlanOperation?.(msg.plan!.id, operation.key, patch);
                      setEditingOperationKey(null);
                    }}
                  />)}
                </div>
                <div className="flex justify-end gap-2 mt-2.5">
                  <button type="button" className="secondary-button" onClick={() => onDiscardPlan?.(msg.id)} disabled={confirmingPlanId === msg.plan.id}>取消</button>
                  <button type="button" className="primary-button" onClick={() => onConfirmPlan?.(msg.id, msg.plan!.id)} disabled={confirmingPlanId === msg.plan.id}>
                    {confirmingPlanId === msg.plan.id ? '正在创建…' : '确认并创建'}
                  </button>
                </div>
              </div>
            )}

            {/* 使用结构化数据渲染可点击日程卡片 */}
            {msg.scheduleItems && msg.scheduleItems.length > 0 && (
              <div className="mt-2">
                {msg.scheduleItems.map(schedule => (
                  <ScheduleMiniCard
                    key={schedule.id}
                    schedule={schedule}
                    onOpen={onOpenSchedule}
                    onOpenMenu={onOpenScheduleMenu}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

export function AiSchedulePanel({
  onSchedulesCreated,
  onOpenSchedule,
  onOpenScheduleMenu,
  collapsed = false,
  onToggleCollapsed,
  initialNoteId,
}: AiSchedulePanelProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null);
  const [savingPlanOperationKey, setSavingPlanOperationKey] = useState<string | null>(null);
  const [noteItems, setNoteItems] = useState<NoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [noteDrawerOpen, setNoteDrawerOpen] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    if (initialNoteId) setNoteDrawerOpen(true);
  }, [initialNoteId]);
  const { isAuthenticated, token, authHeaders } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const retryRequestIdsRef = useRef(new Map<string, { requestId: string; expiresAt: number }>());
  const inputRevisionRef = useRef(0);

  // 加载历史消息
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch('/api/ai-schedule/history', { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.messages) {
          const msgs = data.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            type: m.type || ((m.role === 'assistant' && m.intent) ? 'schedules' : 'text'),
            text: m.text || m.content || m.reply || '',
            intent: m.intent,
            scheduleItems: m.scheduleItems || m.schedule_items || undefined,
            plan: m.plan,
            timestamp: m.timestamp || m.created_at || new Date().toISOString(),
          })) as ChatMessage[];
          setMessages(msgs);
        }
      })
      .catch(() => {});
  }, [isAuthenticated, authHeaders]);

  const loadNoteItems = useCallback(async () => {
    if (!isAuthenticated) return;
    setNotesLoading(true);
    try {
      const response = await fetch('/api/note-items', { headers: authHeaders() });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '获取记事失败');
      setNoteItems(Array.isArray(data.items) ? data.items : []);
      setNotesError(null);
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : '获取记事失败');
    } finally {
      setNotesLoading(false);
    }
  }, [authHeaders, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) void loadNoteItems();
    else setNoteItems([]);
  }, [isAuthenticated, loadNoteItems]);

  // 自动滚到底部
  useEffect(() => {
    const container = messagesContainerRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 96);
    textarea.style.height = `${Math.max(nextHeight, 38)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 96 ? 'auto' : 'hidden';
  }, [inputText, collapsed]);

  const handleUpdatePlanOperation = useCallback(async (planId: string, key: string, patch: Record<string, unknown>) => {
    const savingKey = `${planId}:${key}`;
    setSavingPlanOperationKey(savingKey);
    try {
      const response = await fetch(`/api/ai-chat/plans/${encodeURIComponent(planId)}/operations/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(patch),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.operation) throw new Error(data.error || '保存计划项失败');
      setMessages(previous => previous.map(message => message.plan?.id === planId ? {
        ...message,
        plan: {
          ...message.plan!,
          operations: message.plan!.operations.map(operation => operation.key === key ? { ...operation, ...data.operation } : operation),
        },
      } : message));
    } finally {
      setSavingPlanOperationKey(null);
    }
  }, [authHeaders]);

  const submitMessage = useCallback(async (rawText: string, options: {
    clearComposer?: boolean;
  } = {}) => {
    const text = rawText.trim();
    if (!text || isLoading) return;

    const clearComposer = options.clearComposer !== false;
    const draftRevision = inputRevisionRef.current;
    const clearedRevision = draftRevision + (clearComposer ? 1 : 0);
    const today = getLocalDateString();
    const targetCalendarId = 'personal';
    const requestSignature = `${today}|${targetCalendarId}|${text}`;
    const retryEntry = retryRequestIdsRef.current.get(requestSignature);
    const requestId = retryEntry && retryEntry.expiresAt > Date.now() ? retryEntry.requestId : createRequestId();
    if (clearComposer) {
      inputRevisionRef.current = clearedRevision;
      setInputText('');
    }
    setIsLoading(true);

    // 先添加用户消息；来源记事也作为当前对话中的普通用户消息显示。
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      type: 'text',
      text,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        signal: AbortSignal.timeout(AI_RESPONSE_TIMEOUT_MS),
        body: JSON.stringify({
          text,
          targetDate: today,
          calendarId: targetCalendarId,
          requestId,
        }),
      });

      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.error || '处理失败');
      retryRequestIdsRef.current.delete(requestSignature);

      const aiMsg: ChatMessage = {
        id: data.historyMessageId || (Date.now() + 1).toString(),
        role: 'assistant',
        type: data.requiresConfirmation ? 'plan' : data.intent === 'chat' || data.intent === 'query' || data.intent === 'weather' ? 'text' :
              data.intent === 'update' || data.intent === 'delete' ? 'update' : 'schedules',
        intent: data.intent,
        text: data.reply,
        scheduleItems: data.scheduleItems || [],
        plan: data.plan,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, aiMsg]);

      // 如果有日程变更，通知父组件刷新。
      if (data.changed) onSchedulesCreated?.(data.changedDetails?.created || []);
    } catch (err: any) {
      const errorMsg = err.message || '';
      const isLoginError = errorMsg.includes('未登录') || errorMsg.includes('登录');
      const isPending = errorMsg.includes('仍在处理中');
      const mayStillBeProcessing = err?.name === 'TimeoutError' || errorMsg.includes('非 JSON 内容') || isPending;
      if (mayStillBeProcessing) {
        retryRequestIdsRef.current.set(requestSignature, { requestId, expiresAt: Date.now() + AI_RETRY_WINDOW_MS });
        // AI 生成期间用户可以继续输入；只有草稿没有发生变化时才恢复本次请求内容。
        if (clearComposer && inputRevisionRef.current === clearedRevision) {
          inputRevisionRef.current += 1;
          setInputText(text);
        }
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        type: 'error',
        text: isLoginError
          ? (errorMsg || '请先在设置中保存个人 API Key')
          : mayStillBeProcessing
            ? '请求已超出前端等待时间，服务端可能仍在整理计划。本次内容已保留；生成期间新增的输入不会被覆盖，稍后再次发送可取得同一结果。'
            : (errorMsg || '处理失败，请重试'),
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }, [authHeaders, isLoading, onSchedulesCreated]);

  const handleSubmit = useCallback(() => {
    void submitMessage(inputText, { clearComposer: true });
  }, [inputText, submitMessage]);

  const updateNoteFromApi = useCallback(async (id: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/note-items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await readJsonResponse(response);
    if (!response.ok || !data.item) throw new Error(data.error || '更新记事失败');
    setNoteItems(previous => previous.map(item => item.id === id ? data.item : item));
    setNotesError(null);
  }, [authHeaders]);

  const handleToggleNote = useCallback(async (note: NoteItem) => {
    try {
      await updateNoteFromApi(note.id, { completed: !note.completed });
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : '更新记事失败');
      throw error;
    }
  }, [updateNoteFromApi]);

  const handleEditNote = useCallback(async (note: NoteItem, content: string) => {
    try {
      await updateNoteFromApi(note.id, { content });
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : '更新记事失败');
      throw error;
    }
  }, [updateNoteFromApi]);

  const handleColorChange = useCallback(async (note: NoteItem, color: NoteItem['color']) => {
    try {
      await updateNoteFromApi(note.id, { color });
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : '更新记事颜色失败');
      throw error;
    }
  }, [updateNoteFromApi]);

  const handleDeleteNote = useCallback(async (note: NoteItem) => {
    try {
      const response = await fetch(`/api/note-items/${encodeURIComponent(note.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || '删除记事失败');
      setNoteItems(previous => previous.filter(item => item.id !== note.id));
      setNotesError(null);
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : '删除记事失败');
      throw error;
    }
  }, [authHeaders]);

  const handleSaveNotes = useCallback(async () => {
    if (isLoading || savingNotes || !inputText.trim()) return;
    const draftRevision = inputRevisionRef.current;
    setSavingNotes(true);
    setNotesError(null);
    try {
      const response = await fetch('/api/note-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: inputText }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '保存记事失败');
      const created = Array.isArray(data.items) ? data.items as NoteItem[] : [];
      setNoteItems(previous => [...created, ...previous]);
      if (inputRevisionRef.current === draftRevision) {
        inputRevisionRef.current += 1;
        setInputText('');
      }
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : '保存记事失败');
    } finally {
      setSavingNotes(false);
      textareaRef.current?.focus();
    }
  }, [authHeaders, inputText, isLoading, savingNotes]);

  const handleSendNoteToAi = useCallback((note: NoteItem) => {
    void submitMessage(note.content, { clearComposer: false });
  }, [submitMessage]);

  const handleConfirmPlan = useCallback(async (messageId: string, planId: string) => {
    if (confirmingPlanId) return;
    setConfirmingPlanId(planId);
    try {
      const response = await fetch('/api/ai-chat/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ planId }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '确认计划失败');
      setMessages(previous => previous.map(message => message.id === messageId ? {
        ...message,
        type: 'schedules',
        text: data.reply,
        plan: undefined,
        scheduleItems: data.scheduleItems || [],
      } : message));
      fetch('/api/ai-schedule/history/' + messageId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          type: 'schedules',
          content: data.reply || '计划已确认执行。',
          intent: data.intent || 'create',
          scheduleItems: data.scheduleItems || [],
          plan: null,
        }),
      }).catch(() => {});
      if (data.changed) onSchedulesCreated?.(data.changedDetails?.created || []);
    } catch (error: any) {
      setMessages(previous => [...previous, {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        type: 'error',
        text: error?.message || '确认计划失败，请重试。',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setConfirmingPlanId(null);
    }
  }, [authHeaders, confirmingPlanId, onSchedulesCreated]);

  const handleDiscardPlan = useCallback(async (messageId: string) => {
    const discarded = messages.find(message => message.id === messageId);
    setMessages(previous => previous.map(message => message.id === messageId ? {
      ...message,
      type: 'text',
      text: '已取消这份计划，尚未创建或修改任何日程。',
      plan: undefined,
    } : message));
    if (discarded) {
      fetch('/api/ai-schedule/history/' + messageId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ type: 'text', content: '已取消这份计划，尚未创建或修改任何日程。', intent: discarded.intent || null, plan: null }),
      }).catch(() => {});
    }
  }, [authHeaders, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isLoading) {
      // 生成期间保留普通输入和换行，但不允许发送或保存记事。
      if (e.key === 'Enter' && e.ctrlKey) e.preventDefault();
      return;
    }
    if (noteMode) {
      if (!e.nativeEvent.isComposing && e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        void handleSaveNotes();
      }
      return;
    }
    if (!e.nativeEvent.isComposing && e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const clearHistory = async () => {
    try {
      await fetch('/api/ai-schedule/history', { method: 'DELETE', headers: authHeaders() });
    } finally {
      setMessages([]);
    }
  };

  const EXAMPLES = [
    '今天上午去车站接人，下午两点开会，晚上约朋友吃饭',
    '把晚饭时间改成7点',
    '今天有什么安排？',
    '北京明天天气怎么样？',
    '帮我分析一下如何安排深度工作时间',
  ];
  const pendingNoteCount = noteItems.filter(item => !item.completed).length;

  return (
    <div className="ai-assistant-workspace">
      <div className="flex flex-col h-full schedule-ai-panel" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
      {/* 工具栏：保持简洁，主要内容留给对话和记事板。 */}
      <div className="schedule-ai-toolbar" style={{ borderBottom: '1px solid var(--td-component-stroke)' }}>
        <div className="schedule-ai-toolbar-left">
          {!collapsed && messages.length > 0 && (
            <button type="button" className="schedule-ai-toolbar-button" onClick={clearHistory} title="重置对话" aria-label="重置对话">
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重置</span>
            </button>
          )}
        </div>
        <div className="schedule-ai-heading-actions">
          <button
            type="button"
            className="note-board-trigger"
            onClick={() => setNoteDrawerOpen(open => !open)}
            aria-expanded={noteDrawerOpen}
            aria-controls="ai-note-board"
            title="打开 AI 记事板"
          >
            <span className="note-board-trigger-icon"><StickyNote size={18} aria-hidden="true" /></span>
            <span className="note-board-trigger-label">记事板</span>
            {pendingNoteCount > 0 && <em aria-label={`${pendingNoteCount} 条未完成记事`}>{pendingNoteCount}</em>}
          </button>
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
              style={{
                color: 'var(--td-text-color-secondary)',
                backgroundColor: 'transparent',
                border: 'none',
              }}
              aria-label={collapsed ? '展开 AI 日程助手' : '隐藏 AI 日程助手'}
              title={collapsed ? '展开 AI 日程助手' : '隐藏 AI 日程助手'}
            >
              {collapsed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* 对话区域 */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 py-3">
          <div className="schedule-ai-reading-column">
        {/* 空状态：快捷示例 */}
        {messages.length === 0 && !isLoading && (
          <div>
            <div className="text-center mb-4 pt-4">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mx-auto mb-2"
                style={{ backgroundColor: 'var(--td-brand-color-light)' }}>
                <Bot className="w-6 h-6" style={{ color: 'var(--td-brand-color)' }} />
              </div>
              <div className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                你好，我是 AI 日程助手
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                告诉我你的安排，或者问我修改日程
              </div>
            </div>
            <div className="space-y-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => { inputRevisionRef.current += 1; setInputText(ex); }}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg transition-all"
                  style={{
                    backgroundColor: 'var(--td-bg-color-page)',
                    color: 'var(--td-text-color-secondary)',
                    border: '1px dashed var(--td-component-stroke)',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--td-brand-color)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--td-brand-color)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--td-component-stroke)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--td-text-color-secondary)';
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息列表 */}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onOpenSchedule={onOpenSchedule}
            onOpenScheduleMenu={onOpenScheduleMenu}
            onConfirmPlan={handleConfirmPlan}
            onDiscardPlan={handleDiscardPlan}
            onUpdatePlanOperation={handleUpdatePlanOperation}
            confirmingPlanId={confirmingPlanId}
            savingPlanOperationKey={savingPlanOperationKey}
          />
        ))}

        {/* 加载中 */}
        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl rounded-tl-sm"
              style={{ backgroundColor: 'var(--td-bg-color-page)', border: '1px solid var(--td-component-stroke)' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--td-brand-color)' }} />
              <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>思考中...</span>
            </div>
          </div>
        )}

          </div>

            <div />
          </div>

          {/* 输入框 */}
          <div
            className="flex-shrink-0 schedule-ai-composer-wrap"
            style={{ borderTop: '1px solid var(--td-component-stroke)' }}
          >
            <div
              className={`rounded-xl transition-all schedule-ai-composer${noteMode ? ' is-note-mode' : ''}`}
            >
              <button
                type="button"
                className="schedule-ai-note-toggle"
                onClick={() => setNoteMode(mode => !mode)}
                disabled={isLoading || savingNotes}
                aria-pressed={noteMode}
                aria-label={noteMode ? '关闭记事模式' : '打开记事模式'}
                title={noteMode ? '关闭记事模式' : '打开记事模式'}
              >
                <StickyNote className="w-4 h-4" aria-hidden="true" />
                {noteMode && <CheckCircle2 className="schedule-ai-note-toggle-check" size={11} aria-hidden="true" />}
              </button>
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => { inputRevisionRef.current += 1; setInputText(e.target.value); }}
                onKeyDown={handleKeyDown}
                placeholder={noteMode ? '每行一条，轻松记录' : '输入日程、修改要求或随意聊天...'}
                rows={1}
                className="resize-none text-sm outline-none bg-transparent border-0 schedule-ai-composer-field"
                style={{ color: 'var(--td-text-color-primary)', border: 0, boxShadow: 'none' }}
                aria-label={noteMode ? '记事输入框' : 'AI 助手输入框'}
              />
              <span className="schedule-ai-composer-shortcut">{noteMode ? 'Enter 换行 · Ctrl+Enter 保存' : 'Enter 换行 · Ctrl+Enter 发送'}</span>
              <button
                type="button"
                onClick={noteMode ? () => { void handleSaveNotes(); } : handleSubmit}
                disabled={!inputText.trim() || isLoading || savingNotes}
                className="schedule-ai-send-button flex items-center justify-center rounded-lg text-xs font-medium transition-all"
                style={{
                  backgroundColor: (!inputText.trim() || isLoading || savingNotes)
                    ? 'var(--td-bg-color-component)'
                    : 'var(--td-brand-color)',
                  color: (!inputText.trim() || isLoading || savingNotes)
                    ? 'var(--td-text-color-disabled)'
                    : '#fff',
                  cursor: (!inputText.trim() || isLoading || savingNotes) ? 'not-allowed' : 'pointer',
                }}
                aria-label={isLoading ? '正在处理' : noteMode ? '保存记事' : '发送'}
                title={noteMode ? 'Ctrl+Enter 保存记事' : 'Ctrl+Enter 发送'}
              >
                {isLoading || savingNotes
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : noteMode ? <Save className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />
                }
              </button>
            </div>
          </div>
        </>
      )}
      </div>
      <NoteBoard
        id="ai-note-board"
        notes={noteItems}
        loading={notesLoading}
        error={notesError}
        aiBusy={isLoading}
        drawerOpen={noteDrawerOpen}
        onCloseDrawer={() => setNoteDrawerOpen(false)}
        onToggleCompleted={handleToggleNote}
        onEdit={handleEditNote}
        onColorChange={handleColorChange}
        onDelete={handleDeleteNote}
        onSendToAi={handleSendNoteToAi}
      />
      {noteDrawerOpen && <button type="button" className="note-board-scrim" onClick={() => setNoteDrawerOpen(false)} aria-label="关闭记事板" />}
    </div>
  );
}
