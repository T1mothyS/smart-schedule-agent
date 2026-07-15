import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Sparkles, Loader2, CheckCircle2, MapPin, Clock, Trash2, Calendar, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

// ==================== 类型 ====================

interface Schedule {
  id: string;
  calendar_id: string;
  type: 'event' | 'todo';
  title: string;
  start_time: string;
  end_time?: string;
  all_day: boolean;
  location?: string;
  notes?: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  is_completed: boolean;
}

interface CalendarItem {
  id: string;
  name: string;
  color: string;
  icon: string;
}

type MessageRole = 'user' | 'assistant';
type MessageType = 'text' | 'schedules' | 'update' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  type: MessageType;
  text?: string;
  intent?: string;
  schedules?: Schedule[];
  updatedSchedules?: Schedule[];
  deletedIds?: string[];
  scheduleCards?: string;  // HTML格式的日程卡片
  timestamp: string;
}

interface AiSchedulePanelProps {
  onSchedulesCreated?: (schedules: Schedule[]) => void;
  activeCalendarIds?: string[];
}

// ==================== 常量 ====================

const CATEGORY_COLORS: Record<string, string> = {
  travel: '#F59E0B', work: '#3B82F6', social: '#EC4899',
  life: '#10B981', health: '#EF4444', other: '#6B7280',
};

const CATEGORY_LABELS: Record<string, string> = {
  travel: '出行', work: '工作', social: '社交',
  life: '生活', health: '健康', other: '其他',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: '#EF4444', medium: '#F59E0B', low: '#10B981',
};

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

function ScheduleMiniCard({ schedule, calendars, onDelete }: {
  schedule: Schedule;
  calendars: CalendarItem[];
  onDelete?: (id: string) => void;
}) {
  const color = CATEGORY_COLORS[schedule.category] || '#6B7280';
  const pColor = PRIORITY_COLORS[schedule.priority] || '#F59E0B';
  const cal = calendars.find(c => c.id === schedule.calendar_id);
  const dateStr = formatDate(schedule.start_time);
  const startStr = schedule.all_day ? '全天' : formatTime(schedule.start_time);
  const endStr = schedule.end_time && !schedule.all_day ? ` - ${formatTime(schedule.end_time)}` : '';

  return (
    <div
      className="rounded-xl p-3 mb-2 relative group"
      style={{
        background: `linear-gradient(135deg, ${pColor}10, ${color}06)`,
        border: `1px solid ${pColor}30`,
        borderLeft: `3px solid ${pColor}`,
      }}
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {/* 日程表来源标识 */}
          {cal && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5"
              style={{ backgroundColor: `${cal.color}20`, color: cal.color }}
            >
              <span className="text-xs">{cal.icon}</span>
              {cal.name.slice(0, 2)}
            </span>
          )}
          {/* 分类标签 */}
          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: `${color}20`, color }}>
            {schedule.type === 'todo' ? '待办' : CATEGORY_LABELS[schedule.category] || '其他'}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: `${pColor}15`, color: pColor }}
          >
            {schedule.priority === 'high' ? '高' : schedule.priority === 'low' ? '低' : '中'}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--td-text-color-primary)' }}>
            {schedule.title}
          </span>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(schedule.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded flex-shrink-0"
            style={{ color: '#EF4444' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1" style={{ color: 'var(--td-text-color-secondary)' }}>
          <Clock className="w-3 h-3" />
          <span className="text-xs">{dateStr} {startStr}{endStr}</span>
        </div>
        {schedule.location && (
          <div className="flex items-center gap-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            <MapPin className="w-3 h-3" />
            <span className="text-xs truncate max-w-[100px]">{schedule.location}</span>
          </div>
        )}
      </div>

      {schedule.notes && (
        <div className="mt-1.5 text-xs rounded-lg px-2 py-1"
          style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}>
          💡 {schedule.notes}
        </div>
      )}
    </div>
  );
}

// ==================== 消息气泡 ====================

function MessageBubble({ msg, calendars, onDeleteSchedule }: {
  msg: ChatMessage;
  calendars: CalendarItem[];
  onDeleteSchedule?: (id: string) => void;
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
  const intentIcon: Record<string, string> = {
    create: '✨', update: '✏️', delete: '🗑️', query: '🔍', chat: '💬'
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
            <Sparkles className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
            AI 助手
            {msg.intent && msg.intent !== 'chat' && (
              <span className="ml-1">{intentIcon[msg.intent] || ''}</span>
            )}
          </span>
        </div>

        {msg.type === 'error' ? (
          <div className="px-3 py-2 rounded-xl text-xs whitespace-pre-line" style={{ backgroundColor: '#FEF2F2', color: '#EF4444', border: '1px solid #FCA5A5' }}>
            ⚠️ {msg.text}
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

            {/* 日程卡片展示（HTML格式）- 后端已统一生成，避免重复渲染 */}
            {msg.scheduleCards && (
              <div 
                className="mt-2"
                dangerouslySetInnerHTML={{ __html: msg.scheduleCards }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

export function AiSchedulePanel({ onSchedulesCreated, activeCalendarIds }: AiSchedulePanelProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const { isAuthenticated, token, authHeaders } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 加载日程表信息（用于显示来源标识）
  useEffect(() => {
    fetch('/api/calendars', { headers: authHeaders() })
      .then(r => r.json())
      .then(data => setCalendars(data.calendars || []))
      .catch(() => {});
  }, []);

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
            type: (m.role === 'assistant' && m.intent) ? 'schedules' : 'text',
            text: m.content || m.reply || '',
            intent: m.intent,
            timestamp: m.created_at,
          })) as ChatMessage[];
          setMessages(msgs.slice(-20)); // 最近20条
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  // 自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

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
      const today = getLocalDateString();
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          text,
          targetDate: today,
          calendarId: (activeCalendarIds && activeCalendarIds.length > 0) ? activeCalendarIds[0] : 'personal',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '处理失败');

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        type: data.intent === 'chat' || data.intent === 'query' ? 'text' :
              data.intent === 'update' || data.intent === 'delete' ? 'update' : 'schedules',
        intent: data.intent,
        text: data.reply,
        schedules: data.created?.length > 0 ? data.created : undefined,
        updatedSchedules: data.updated?.length > 0 ? data.updated : undefined,
        deletedIds: data.deletedIds?.length > 0 ? data.deletedIds : undefined,
        scheduleCards: data.scheduleCards,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, aiMsg]);

      // 如果有日程变更，通知父组件刷新
      if (data.changed) {
        onSchedulesCreated?.(data.created || []);
      }
    } catch (err: any) {
      // 检查是否是未登录错误
      const errorMsg = err.message || '';
      const isLoginError = errorMsg.includes('未登录') || errorMsg.includes('登录');
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        type: 'error',
        text: isLoginError 
          ? '⚠️ ' + (errorMsg || '请先配置 API Key 或登录 CodeBuddy CLI')
          : (errorMsg || '处理失败，请重试'),
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }, [inputText, isLoading, isAuthenticated, activeCalendarIds, onSchedulesCreated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDeleteFromMsg = useCallback(async (scheduleId: string) => {
    try {
      await fetch(`/api/schedules/${scheduleId}`, { method: 'DELETE', headers: authHeaders() });
      setMessages(prev => prev.map(m => {
        if (m.schedules) {
          return { ...m, schedules: m.schedules.filter(s => s.id !== scheduleId) };
        }
        return m;
      }));
      onSchedulesCreated?.([]);
    } catch {}
  }, [onSchedulesCreated]);

  const clearHistory = () => setMessages([]);

  const EXAMPLES = [
    '今天上午去车站接人，下午两点开会，晚上约朋友吃饭',
    '把晚饭时间改成7点',
    '今天有什么安排？',
    '明天下午3点有个重要会议',
  ];

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
      {/* 面板头部 */}
      <div
        className="px-4 pt-3 pb-2.5 flex-shrink-0 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--td-component-stroke)' }}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: 'var(--td-brand-color)' }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
              AI 日程助手
            </div>
            <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              可对话 · 新增 · 修改 · 查询
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
            style={{ 
              color: 'var(--td-text-color-secondary)',
              backgroundColor: 'transparent',
              border: 'none',
            }}
            title="清空对话"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 对话区域 */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {/* 空状态：快捷示例 */}
        {messages.length === 0 && !isLoading && (
          <div>
            <div className="text-center mb-4 pt-4">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mx-auto mb-2"
                style={{ backgroundColor: 'var(--td-brand-color-light)' }}>
                <Calendar className="w-5 h-5" style={{ color: 'var(--td-brand-color)' }} />
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
            calendars={calendars}
            onDeleteSchedule={handleDeleteFromMsg}
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

        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <div
        className="px-3 pb-3 pt-2 flex-shrink-0"
        style={{ borderTop: '1px solid var(--td-component-stroke)' }}
      >
        <div
          className="rounded-xl overflow-hidden transition-all"
          style={{
            border: '1.5px solid var(--td-component-stroke)',
            backgroundColor: 'var(--td-bg-color-page)',
          }}
          onFocusCapture={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--td-brand-color)'}
          onBlurCapture={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--td-component-stroke)'}
        >
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入日程、修改要求或随意聊天..."
            rows={3}
            className="w-full px-3 pt-2.5 pb-1 resize-none text-sm outline-none bg-transparent"
            style={{ color: 'var(--td-text-color-primary)' }}
            disabled={isLoading}
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
              Enter 发送 · Shift+Enter 换行
            </span>
            <button
              onClick={handleSubmit}
              disabled={!inputText.trim() || isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                backgroundColor: (!inputText.trim() || isLoading)
                  ? 'var(--td-bg-color-component)'
                  : 'var(--td-brand-color)',
                color: (!inputText.trim() || isLoading)
                  ? 'var(--td-text-color-disabled)'
                  : '#fff',
                cursor: (!inputText.trim() || isLoading) ? 'not-allowed' : 'pointer',
              }}
            >
              {isLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />处理中</>
                : <><Send className="w-3.5 h-3.5" />发送</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
