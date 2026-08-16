import { useState, useRef, useCallback, useEffect } from 'react';
import { Bot, Send, Loader2, CheckCircle2, Eye, EyeOff, MapPin, Clock, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { SCHEDULE_CATEGORY_COLORS, SCHEDULE_CATEGORY_LABELS } from '../utils/scheduleCategories';

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
}

// ==================== 常量 ====================

const CATEGORY_COLORS = SCHEDULE_CATEGORY_COLORS;
const CATEGORY_LABELS = SCHEDULE_CATEGORY_LABELS;

const PRIORITY_COLORS: Record<string, string> = {
  high: '#EF4444', medium: '#F59E0B', low: '#10B981',
};

const AI_RESPONSE_TIMEOUT_MS = 330_000;
const AI_RETRY_WINDOW_MS = 15 * 60 * 1000;

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

function MessageBubble({ msg, onOpenSchedule, onOpenScheduleMenu, onConfirmPlan, onDiscardPlan, confirmingPlanId }: {
  msg: ChatMessage;
  onOpenSchedule?: (id: string) => void;
  onOpenScheduleMenu?: (id: string, x: number, y: number) => void;
  onConfirmPlan?: (messageId: string, planId: string) => void;
  onDiscardPlan?: (messageId: string) => void;
  confirmingPlanId?: string | null;
}) {
  const isUser = msg.role === 'user';

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
    create: '创建', update: '修改', delete: '删除', query: '查询', chat: '对话'
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
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#10B981' }} />
                <span className="text-xs leading-relaxed font-medium whitespace-pre-line" style={{ color: '#10B981' }}>
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
                  {msg.plan.operations.map(operation => {
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
                    return (
                      <div key={operation.key} className="rounded-md px-2 py-1.5" style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid #DBEAFE' }}>
                        <div className="text-xs font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{operation.title}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>{actionLabel[operation.type] || '处理'} · {timeLabel}</div>
                        {operation.location && <div className="text-[11px] mt-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>地点：{operation.location}</div>}
                        {operation.notes && <div className="text-[11px] mt-0.5 whitespace-pre-line" style={{ color: 'var(--td-text-color-secondary)' }}>备注：{operation.notes}</div>}
                      </div>
                    );
                  })}
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
}: AiSchedulePanelProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null);
  const { isAuthenticated, token, authHeaders } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const retryRequestIdsRef = useRef(new Map<string, { requestId: string; expiresAt: number }>());

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
  }, [isAuthenticated]);

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

  const handleSubmit = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    const today = getLocalDateString();
    const targetCalendarId = 'personal';
    const requestSignature = `${today}|${targetCalendarId}|${text}`;
    const retryEntry = retryRequestIdsRef.current.get(requestSignature);
    const requestId = retryEntry && retryEntry.expiresAt > Date.now() ? retryEntry.requestId : createRequestId();
    setInputText('');
    setIsLoading(true);

    // 先添加用户消息
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
        type: data.requiresConfirmation ? 'plan' : data.intent === 'chat' || data.intent === 'query' ? 'text' :
              data.intent === 'update' || data.intent === 'delete' ? 'update' : 'schedules',
        intent: data.intent,
        text: data.reply,
        scheduleItems: data.scheduleItems || [],
        plan: data.plan,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, aiMsg]);

      // 如果有日程变更，通知父组件刷新
      if (data.changed) {
        onSchedulesCreated?.(data.changedDetails?.created || []);
      }
    } catch (err: any) {
      const errorMsg = err.message || '';
      const isLoginError = errorMsg.includes('未登录') || errorMsg.includes('登录');
      const isPending = errorMsg.includes('仍在处理中');
      const mayStillBeProcessing = err?.name === 'TimeoutError' || errorMsg.includes('非 JSON 内容') || isPending;
      if (mayStillBeProcessing) {
        retryRequestIdsRef.current.set(requestSignature, { requestId, expiresAt: Date.now() + AI_RETRY_WINDOW_MS });
        setInputText(text);
      }
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        type: 'error',
        text: isLoginError 
          ? (errorMsg || '请先配置 API Key 或登录 CodeBuddy CLI')
          : mayStillBeProcessing
            ? '请求已超出前端等待时间，服务端可能仍在整理计划。内容已保留，请勿修改内容；稍后再次发送可取得同一结果，不会重复创建日程。'
          : (errorMsg || '处理失败，请重试'),
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }, [inputText, isLoading, onSchedulesCreated, authHeaders]);

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
    if (e.key === 'Enter' && !e.shiftKey) {
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
    '明天下午3点有个重要会议',
  ];

  return (
    <div className="flex flex-col h-full schedule-ai-panel" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
      {/* 面板头部 */}
      <div
        className="px-4 pt-3 pb-2.5 flex-shrink-0 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--td-component-stroke)' }}
      >
        <div className="flex items-center gap-2">
          <span className="ai-assistant-heading-icon"><Bot size={23} strokeWidth={2.2} /></span>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
              AI 日程助手
            </div>
            <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              可对话 · 新增 · 修改 · 查询
            </div>
          </div>
        </div>
        <div className="schedule-ai-heading-actions">
          {!collapsed && messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
              style={{
                color: 'var(--td-text-color-secondary)',
                backgroundColor: 'transparent',
                border: 'none',
              }}
              title="清空对话"
              aria-label="清空对话"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
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
                  onClick={() => setInputText(ex)}
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
            confirmingPlanId={confirmingPlanId}
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

            <div />
          </div>

          {/* 输入框 */}
          <div
            className="flex-shrink-0 schedule-ai-composer-wrap"
            style={{ borderTop: '1px solid var(--td-component-stroke)' }}
          >
            <div
              className="rounded-xl transition-all schedule-ai-composer"
              style={{ backgroundColor: 'var(--td-bg-color-page)' }}
            >
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入日程、修改要求或随意聊天..."
                rows={1}
                className="resize-none text-sm outline-none bg-transparent border-0"
                style={{ color: 'var(--td-text-color-primary)', border: 0, boxShadow: 'none' }}
                disabled={isLoading}
                aria-label="AI 日程助手输入框"
              />
              <span className="schedule-ai-composer-shortcut">Enter 发送 · Shift+Enter 换行</span>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!inputText.trim() || isLoading}
                className="schedule-ai-send-button flex items-center justify-center rounded-lg text-xs font-medium transition-all"
                style={{
                  backgroundColor: (!inputText.trim() || isLoading)
                    ? 'var(--td-bg-color-component)'
                    : 'var(--td-brand-color)',
                  color: (!inputText.trim() || isLoading)
                    ? 'var(--td-text-color-disabled)'
                    : '#fff',
                  cursor: (!inputText.trim() || isLoading) ? 'not-allowed' : 'pointer',
                }}
                aria-label={isLoading ? '正在处理' : '发送'}
                title="Enter 发送 · Shift+Enter 换行"
              >
                {isLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
