import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronDown, ChevronLeft, ChevronRight, Plus, MapPin, Clock, CheckCircle2,
  Circle, Trash2, Edit3, Calendar, CalendarDays, LayoutList, LayoutGrid, X, Bell, AlertTriangle,
  PanelLeftOpen
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { 
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval 
} from 'date-fns';
import { AgendaView } from './calendar/AgendaView';
import { ScheduleContextMenu } from './calendar/ScheduleContextMenu';
import { getCalendarDayMeta } from './calendar/calendarMeta';

// ==================== 类型定义 ====================

export interface Schedule {
  id: string;
  calendar_id: string;
  type: 'event' | 'todo';
  title: string;
  description?: string;
  start_time: string;
  end_time?: string;
  all_day: boolean;
  is_unscheduled?: boolean;
  location?: string;
  notes?: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  is_completed: boolean;
  is_repeated: boolean;
  repeat_rule?: string;
  reminders: string[];
  created_at: string;
  updated_at: string;
}

type ViewMode = 'agenda' | 'day' | 'week' | 'month';

// ==================== 常量 ====================

const CATEGORY_COLORS: Record<string, string> = {
  travel: '#F59E0B',
  work: '#3B82F6',
  social: '#EC4899',
  life: '#10B981',
  health: '#EF4444',
  other: '#6B7280',
};

const CATEGORY_LABELS: Record<string, string> = {
  travel: '出行', work: '工作', social: '社交',
  life: '生活', health: '健康', other: '其他',
};

// 优先级颜色系统
const PRIORITY_COLORS: Record<string, { bg: string; border: string; dot: string; label: string }> = {
  high:   { bg: '#FEF2F2', border: '#EF4444', dot: '#EF4444', label: '高优先' },
  medium: { bg: '#FFFBEB', border: '#F59E0B', dot: '#F59E0B', label: '中优先' },
  low:    { bg: '#F0FDF4', border: '#10B981', dot: '#10B981', label: '低优先' },
};

// 暗色模式优先级颜色
const PRIORITY_COLORS_DARK: Record<string, { bg: string; border: string; dot: string }> = {
  high:   { bg: 'rgba(239,68,68,0.15)',   border: '#EF4444', dot: '#EF4444' },
  medium: { bg: 'rgba(245,158,11,0.12)',  border: '#F59E0B', dot: '#F59E0B' },
  low:    { bg: 'rgba(16,185,129,0.12)',  border: '#10B981', dot: '#10B981' },
};

const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// ==================== 工具函数 ====================

// 【关键修复】获取本地时区的日期字符串
function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatScheduleDate(value: string): { date: string; weekday: string; isToday: boolean } {
  const parsed = parseDateKey(value);
  if (!parsed) return { date: '选择日期', weekday: '', isToday: false };
  return {
    date: parsed.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
    weekday: WEEKDAY_LABELS[parsed.getDay()],
    isToday: toDateKey(parsed) === toDateKey(new Date()),
  };
}

function isSameDay(a: Date, b: Date): boolean {
  // 使用 date-fns 的 isSameDay 避免时区问题
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

// 获取日期的开始时间（本地时区）
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 解析日期字符串为本地时区的 Date 对象
function parseLocalDate(dateStr: string): Date {
  const [datePart, timePart] = dateStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  if (timePart) {
    const [hour, minute, second] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hour || 0, minute || 0, second || 0);
  }
  return new Date(year, month - 1, day);
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthDates(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const weekStart = getWeekStart(firstDay);
  const dates: Date[] = [];
  const cur = new Date(weekStart);
  while (cur <= lastDay || dates.length % 7 !== 0) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
    if (dates.length > 42) break;
  }
  return dates;
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

function getScheduleHour(s: Schedule): number {
  try { return parseLocalDate(s.start_time).getHours(); } catch { return 0; }
}

function getScheduleMinute(s: Schedule): number {
  try { return parseLocalDate(s.start_time).getMinutes(); } catch { return 0; }
}

function getDurationMinutes(s: Schedule): number {
  if (!s.end_time) return 60;
  try {
    const diff = parseLocalDate(s.end_time).getTime() - parseLocalDate(s.start_time).getTime();
    return Math.max(30, Math.floor(diff / 60000));
  } catch { return 60; }
}

// 根据优先级获取日程主色
function getScheduleColor(schedule: Schedule): string {
  const pColors = PRIORITY_COLORS[schedule.priority] || PRIORITY_COLORS.medium;
  return pColors.dot;
}

// ==================== 冲突检测工具函数 ====================

// 检测日程之间的冲突（两个日程时间重叠）
function checkScheduleConflict(a: Schedule, b: Schedule): boolean {
  // 跳过全天事件
  if (a.all_day || b.all_day) return false;
  const aStart = parseLocalDate(a.start_time).getTime();
  const aEnd = a.end_time ? parseLocalDate(a.end_time).getTime() : aStart + 3600000;
  const bStart = parseLocalDate(b.start_time).getTime();
  const bEnd = b.end_time ? parseLocalDate(b.end_time).getTime() : bStart + 3600000;
  // 冲突：a开始 < b结束 且 a结束 > b开始
  return aStart < bEnd && aEnd > bStart;
}

// 获取一天的冲突日程组（返回冲突日程ID集合）
// includeTodos: 是否包括待办任务（用于排版，但不提示冲突）
function getConflictingScheduleIds(schedules: Schedule[], includeTodos = false): Set<string> {
  const conflictingIds = new Set<string>();
  // 所有非全天日程都参与冲突检测（包括已完成）
  const filter = includeTodos
    ? (s: Schedule) => !s.all_day
    : (s: Schedule) => !s.all_day && s.type === 'event';
  const activeSchedules = schedules.filter(filter);
  
  for (let i = 0; i < activeSchedules.length; i++) {
    for (let j = i + 1; j < activeSchedules.length; j++) {
      if (checkScheduleConflict(activeSchedules[i], activeSchedules[j])) {
        conflictingIds.add(activeSchedules[i].id);
        conflictingIds.add(activeSchedules[j].id);
      }
    }
  }
  return conflictingIds;
}

// 按时间段分组冲突日程（用于从左到右排列）
// includeTodos: 是否包括待办任务（用于排版，但不提示冲突）
function groupConflictingSchedulesByTimeSlot(schedules: Schedule[], includeTodos = false): Map<string, Schedule[]> {
  const conflictMap = new Map<string, Schedule[]>();
  // 所有非全天日程都参与冲突检测（包括已完成）
  const filter = includeTodos
    ? (s: Schedule) => !s.all_day
    : (s: Schedule) => !s.all_day && s.type === 'event';
  const activeSchedules = schedules.filter(filter);
  
  // 检测所有冲突对
  const conflictPairs: [Schedule, Schedule][] = [];
  for (let i = 0; i < activeSchedules.length; i++) {
    for (let j = i + 1; j < activeSchedules.length; j++) {
      if (checkScheduleConflict(activeSchedules[i], activeSchedules[j])) {
        conflictPairs.push([activeSchedules[i], activeSchedules[j]]);
      }
    }
  }
  
  // 按开始时间排序
  conflictPairs.sort((a, b) => new Date(a[0].start_time).getTime() - new Date(b[0].start_time).getTime());
  
  // 分组（同一时间段的冲突日程放一起）
  const processedIds = new Set<string>();
  conflictPairs.forEach(([a, b]) => {
    const key = `${Math.floor(new Date(a.start_time).getTime() / 60000)}_${Math.floor(new Date(b.start_time).getTime() / 60000)}`;
    if (!conflictMap.has(key)) {
      conflictMap.set(key, []);
    }
    if (!processedIds.has(a.id)) {
      conflictMap.get(key)!.push(a);
      processedIds.add(a.id);
    }
    if (!processedIds.has(b.id)) {
      conflictMap.get(key)!.push(b);
      processedIds.add(b.id);
    }
  });
  
  return conflictMap;
}

// 获取日程在冲突组中的位置索引
function getConflictSlotIndex(scheduleId: string, conflictMap: Map<string, Schedule[]>): number {
  for (const schedules of conflictMap.values()) {
    const index = schedules.findIndex(s => s.id === scheduleId);
    if (index !== -1) return index;
  }
  return -1;
}

// 获取冲突组的日程数量（用于计算宽度）
function getConflictSlotCount(scheduleId: string, conflictMap: Map<string, Schedule[]>): number {
  for (const schedules of conflictMap.values()) {
    if (schedules.some(s => s.id === scheduleId)) {
      return schedules.length;
    }
  }
  return 1;
}

// ==================== 智能时间选择器（手机闹钟风格滚动UI） ====================

function SmartTimePicker({
  value,
  onChange,
  minTime,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  minTime?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const currentHour = parseInt(value?.split(':')[0] || '0');
  const currentMinute = parseInt(value?.split(':')[1] || '0');
  const [selHour, setSelHour] = useState(currentHour);
  const [selMinute, setSelMinute] = useState(currentMinute);
  const hourRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelHour(currentHour);
    setSelMinute(currentMinute);
  }, [value]);

  // 滚动到选中项
  useEffect(() => {
    if (open) {
      const hourItem = hourRef.current?.querySelector(`[data-hour="${selHour}"]`);
      const minItem = minRef.current?.querySelector(`[data-minute="${selMinute}"]`);
      hourItem?.scrollIntoView({ block: 'center' });
      minItem?.scrollIntoView({ block: 'center' });
    }
  }, [open, selHour, selMinute]);

  const handleHourChange = (h: number) => {
    setSelHour(h);
    // 更改小时时预览更新，但不关闭选择器
    onChange(`${String(h).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`);
  };

  const handleMinuteChange = (m: number) => {
    setSelMinute(m);
    onChange(`${String(selHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  const handleConfirm = () => {
    onChange(`${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`);
    setOpen(false);
  };

  return (
    <div className="relative flex-1" ref={useRef(null)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between transition-all"
        style={{
          backgroundColor: 'var(--td-bg-color-component)',
          color: 'var(--td-text-color-primary)',
          border: `1.5px solid ${open ? 'var(--td-brand-color)' : 'var(--td-component-stroke)'}`,
        }}
      >
        <div className="flex items-center gap-2">
          {label && <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>{label}</span>}
          <span className="font-mono">{value || '00:00'}</span>
        </div>
        <Clock className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: 'var(--td-bg-color-container)',
            border: '1px solid var(--td-component-stroke)',
            width: '220px',
          }}
        >
          <div className="flex">
            {/* 小时滚轮 */}
            <div className="flex-1 border-r" style={{ borderColor: 'var(--td-component-stroke)' }}>
              <div className="px-2 py-1.5 text-xs text-center font-medium" style={{ color: 'var(--td-text-color-secondary)', borderBottom: '1px solid var(--td-component-stroke)' }}>
                时
              </div>
              <div ref={hourRef} className="h-32 overflow-y-auto scrollbar-hide" style={{ scrollBehavior: 'auto' }}>
                {hours.map(h => (
                  <div
                    key={h}
                    data-hour={h}
                    onClick={() => handleHourChange(h)}
                    className="px-3 py-1.5 text-center text-sm cursor-pointer transition-all"
                    style={{
                      backgroundColor: selHour === h ? 'var(--td-brand-color)' : 'transparent',
                      color: selHour === h ? '#fff' : 'var(--td-text-color-primary)',
                      fontWeight: selHour === h ? 600 : 400,
                    }}
                  >
                    {String(h).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>
            {/* 分钟滚轮 */}
            <div className="flex-1">
              <div className="px-2 py-1.5 text-xs text-center font-medium" style={{ color: 'var(--td-text-color-secondary)', borderBottom: '1px solid var(--td-component-stroke)' }}>
                分
              </div>
              <div ref={minRef} className="h-32 overflow-y-auto scrollbar-hide" style={{ scrollBehavior: 'auto' }}>
                {minutes.map(m => (
                  <div
                    key={m}
                    data-minute={m}
                    onClick={() => handleMinuteChange(m)}
                    className="px-3 py-1.5 text-center text-sm cursor-pointer transition-all"
                    style={{
                      backgroundColor: selMinute === m ? 'var(--td-brand-color)' : 'transparent',
                      color: selMinute === m ? '#fff' : 'var(--td-text-color-primary)',
                      fontWeight: selMinute === m ? 600 : 400,
                    }}
                  >
                    {String(m).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* 确认按钮 */}
          <div className="px-3 py-2 border-t flex gap-2" style={{ borderColor: 'var(--td-component-stroke)' }}>
            <button
              onClick={() => {
                // 取消，恢复原始值
                setSelHour(currentHour);
                setSelMinute(currentMinute);
                setOpen(false);
              }}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 自定义提前提醒选择器 ====================

function ReminderPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(parseInt(value) || 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const presetOptions = [
    { label: '不提醒', value: '' },
    { label: '5分钟', value: '5' },
    { label: '10分钟', value: '10' },
    { label: '15分钟', value: '15' },
    { label: '30分钟', value: '30' },
    { label: '1小时', value: '60' },
    { label: '2小时', value: '120' },
    { label: '1天', value: '1440' },
  ];

  const isCustom = value && !presetOptions.find(o => o.value === value);

  const formatReminder = (mins: string) => {
    if (!mins) return '不提醒';
    const m = parseInt(mins);
    if (m >= 1440) return `${m / 1440}天`;
    if (m >= 60) return `${m / 60}小时`;
    return `${m}分钟`;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between transition-all"
        style={{
          backgroundColor: 'var(--td-bg-color-component)',
          color: 'var(--td-text-color-primary)',
          border: `1.5px solid ${open ? 'var(--td-brand-color)' : 'var(--td-component-stroke)'}`,
        }}
      >
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          <span>{isCustom ? `提前${formatReminder(value)}` : formatReminder(value)}</span>
        </div>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: 'var(--td-bg-color-container)',
            border: '1px solid var(--td-component-stroke)',
            width: '180px',
          }}
        >
          {/* 预设选项 */}
          <div className="p-2">
            <div className="text-xs mb-1.5 px-1" style={{ color: 'var(--td-text-color-secondary)' }}>快速选择</div>
            <div className="grid grid-cols-2 gap-1">
              {presetOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className="py-1.5 px-2 rounded-lg text-xs transition-all flex items-center gap-1"
                  style={{
                    backgroundColor: value === opt.value ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                    color: value === opt.value ? '#fff' : 'var(--td-text-color-primary)',
                  }}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          {/* 自定义输入 */}
          <div className="px-3 py-2 border-t" style={{ borderColor: 'var(--td-component-stroke)' }}>
            <div className="text-xs mb-1.5 px-1" style={{ color: 'var(--td-text-color-secondary)' }}>自定义分钟数</div>
            <div className="flex gap-1.5">
              <input
                type="number"
                min="1"
                max="10080"
                value={customMinutes || ''}
                onChange={e => setCustomMinutes(parseInt(e.target.value) || 0)}
                placeholder="输入分钟"
                className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{
                  backgroundColor: 'var(--td-bg-color-component)',
                  color: 'var(--td-text-color-primary)',
                  border: '1px solid var(--td-component-stroke)',
                }}
              />
              <button
                onClick={() => {
                  if (customMinutes > 0) {
                    onChange(String(customMinutes));
                    setOpen(false);
                  }
                }}
                className="px-2 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
              >
                设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 日程表单（新增 / 编辑通用） ====================

function ScheduleFormModal({
  defaultDate,
  editingSchedule,
  calendarColor,
  onSave,
  onClose,
  activeCalendars,
}: {
  defaultDate: Date;
  editingSchedule?: Schedule | null;
  calendarColor?: string;
  onSave: (s: Partial<Schedule>) => void;
  onClose: () => void;
  activeCalendars?: Array<{ id: string; name: string; color: string; icon: string }>;
}) {
  const isEditing = !!editingSchedule;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState({
    type: (editingSchedule?.type || 'event') as 'event' | 'todo',
    title: editingSchedule?.title || '',
    date: editingSchedule
      ? editingSchedule.start_time.split('T')[0]
      : toDateKey(defaultDate),
    isUnscheduled: editingSchedule?.is_unscheduled === true,
    startTime: editingSchedule && !editingSchedule.all_day
      ? formatTime(editingSchedule.start_time)
      : '09:00',
    endTime: editingSchedule?.end_time && !editingSchedule.all_day
      ? formatTime(editingSchedule.end_time)
      : '10:00',
    all_day: editingSchedule?.all_day || false,
    location: editingSchedule?.location || '',
    category: editingSchedule?.category || 'other',
    priority: (editingSchedule?.priority || 'medium') as 'high' | 'medium' | 'low',
    notes: editingSchedule?.notes || '',
    reminder: (editingSchedule?.reminders?.[0] || '') as string,
    calendarId: editingSchedule?.calendar_id || (activeCalendars?.[0]?.id || 'personal'),
    // 循环设置
    repeat: (editingSchedule?.is_repeated ? (editingSchedule as any).repeat_rule || 'daily' : '') as '' | 'daily' | 'weekly' | 'monthly',
  });

  const set = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }));
  const selectedDate = formatScheduleDate(form.date);
  const isUnscheduled = form.type === 'todo' && form.isUnscheduled;

  // 类别颜色配置
  const catColor = CATEGORY_COLORS[form.category] || '#6B7280';

  const handleSave = () => {
    if (!form.title.trim()) return;
    const startTime = isUnscheduled
      ? new Date().toISOString()
      : form.all_day
      ? `${form.date}T00:00:00`
      : `${form.date}T${form.startTime}:00`;
    // 待办任务也需要 end_time（用于冲突检测和排版），时长固定1小时
    const endTime = isUnscheduled || form.all_day
      ? undefined
      : `${form.date}T${form.endTime}:00`;

    onSave({
      type: form.type,
      title: form.title.trim(),
      calendar_id: form.calendarId,
      start_time: startTime,
      end_time: endTime,
      all_day: isUnscheduled ? false : form.all_day,
      is_unscheduled: isUnscheduled,
      location: form.location || undefined,
      notes: form.notes || undefined,
      category: form.category,
      priority: form.priority,
      reminders: isUnscheduled ? [] : (form.reminder ? [form.reminder] : []),
      is_repeated: isUnscheduled ? false : !!form.repeat,
      repeat_rule: isUnscheduled ? undefined : (form.repeat || undefined),
    });
  };

  const priorityConfig = PRIORITY_COLORS[form.priority];

  // 类别选项
  const categoryOptions = [
    { key: 'travel', label: '出行', color: CATEGORY_COLORS.travel },
    { key: 'work', label: '工作', color: CATEGORY_COLORS.work },
    { key: 'social', label: '社交', color: CATEGORY_COLORS.social },
    { key: 'life', label: '生活', color: CATEGORY_COLORS.life },
    { key: 'health', label: '健康', color: CATEGORY_COLORS.health },
    { key: 'other', label: '其他', color: CATEGORY_COLORS.other },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={onClose}
    >
      <div
        className="schedule-form-modal rounded-2xl p-6 w-full max-w-md shadow-2xl"
        style={{ backgroundColor: 'var(--td-bg-color-container)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="schedule-form-heading" style={{ color: 'var(--td-text-color-primary)' }}>
            {isEditing ? '编辑日程' : '新增日程'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-60">
            <X className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          </button>
        </div>

        <div className="space-y-4">
          {/* 类型切换 */}
          <div className="flex gap-2">
            {(['event', 'todo'] as const).map(t => (
              <button
                key={t}
                onClick={() => setForm(prev => ({
                  ...prev,
                  type: t,
                  isUnscheduled: t === 'todo' ? prev.isUnscheduled : false,
                }))}
                className="schedule-type-option flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: form.type === t ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                  color: form.type === t ? '#fff' : 'var(--td-text-color-secondary)',
                }}
              >
                {t === 'event' ? <><Calendar size={16} />日程</> : <><CheckCircle2 size={16} />待办</>}
              </button>
            ))}
          </div>

          {/* 标题 */}
          <input
            type="text"
            placeholder="输入日程标题..."
            value={form.title}
            onChange={e => set('title', e.target.value)}
            autoFocus
            className="schedule-title-input w-full px-3 py-2.5 rounded-lg outline-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 日期 - 待办可以切换为无固定期限 */}
          <div className="schedule-date-field">
            <div
              className={`relative overflow-hidden rounded-lg transition-all ${isUnscheduled ? 'is-unscheduled' : 'cursor-pointer hover:border-brand-color'}`}
              style={{
                backgroundColor: 'var(--td-bg-color-component)',
                border: '1.5px solid var(--td-component-stroke)',
              }}
              onClick={() => {
                if (isUnscheduled) return;
                const input = document.getElementById('schedule-date-input') as HTMLInputElement;
                input?.showPicker?.();
              }}
            >
              {!isUnscheduled && (
                <input
                  id="schedule-date-input"
                  type="date"
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className="w-full px-3 py-2 text-sm outline-none cursor-pointer"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--td-text-color-primary)',
                    position: 'absolute',
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    top: 0,
                    left: 0,
                  }}
                />
              )}
              <div className="schedule-date-summary">
                <Calendar className="w-5 h-5" />
                <div>
                  <strong>{isUnscheduled ? '无固定期限' : selectedDate.date}</strong>
                  {isUnscheduled ? <span>完成前持续保留，不绑定具体日期</span> : selectedDate.weekday && <span>{selectedDate.weekday}</span>}
                </div>
                {!isUnscheduled && selectedDate.isToday && <em>今天</em>}
              </div>
            </div>
            {form.type === 'todo' && (
              <label className="schedule-unscheduled-toggle">
                <input
                  type="checkbox"
                  checked={form.isUnscheduled}
                  onChange={event => setForm(prev => ({
                    ...prev,
                    isUnscheduled: event.target.checked,
                    reminder: event.target.checked ? '' : prev.reminder,
                    repeat: event.target.checked ? '' : prev.repeat,
                  }))}
                />
                <span>
                  <strong>无固定期限待办</strong>
                  <small>暂不绑定执行日期，之后可以再切回日期待办</small>
                </span>
              </label>
            )}
          </div>

          {/* 时间（仅日程类型） */}
          {form.type === 'event' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.all_day}
                  onChange={e => set('all_day', e.target.checked)}
                />
                <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>全天事件</span>
              </label>
              {!form.all_day && (
                <div className="flex gap-3 items-center">
                  <SmartTimePicker
                    value={form.startTime}
                    onChange={v => {
                      set('startTime', v);
                      // 自动设置结束时间为开始时间+1小时
                      const [h, m] = v.split(':').map(Number);
                      const endH = (h + 1) % 24;
                      if (form.endTime <= v) {
                        set('endTime', `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
                      }
                    }}
                    label="开始"
                  />
                  <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>至</span>
                  <SmartTimePicker
                    value={form.endTime}
                    onChange={v => set('endTime', v)}
                    minTime={form.startTime}
                    label="结束"
                  />
                </div>
              )}
            </div>
          )}

          {/* 待办时间选择器（只需设置开始时间，占用1小时） */}
          {form.type === 'todo' && !isUnscheduled && (
            <div>
              <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
                待办时间
              </div>
              <div className="flex gap-3 items-center">
                <SmartTimePicker
                  value={form.startTime}
                  onChange={v => {
                    set('startTime', v);
                    // 待办自动设置1小时时长
                    const [h, m] = v.split(':').map(Number);
                    const endH = (h + 1) % 24;
                    set('endTime', `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
                  }}
                  label="开始"
                />
                <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>时长1小时</span>
              </div>
            </div>
          )}

          {/* 提前提醒 - 使用新的ReminderPicker */}
          {!isUnscheduled && <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              提前提醒
            </div>
            <ReminderPicker
              value={form.reminder}
              onChange={v => set('reminder', v)}
            />
          </div>}

          <button
            type="button"
            className={showAdvanced ? 'schedule-advanced-toggle open' : 'schedule-advanced-toggle'}
            onClick={() => setShowAdvanced(value => !value)}
            aria-expanded={showAdvanced}
          >
            <div>
              <strong>高级选项</strong>
              <span>地点、分类、优先级、日程表、备注与重复</span>
            </div>
            <ChevronDown size={17} />
          </button>

          {showAdvanced && <div className="schedule-advanced-options">
          {/* 地点 */}
          <input
            type="text"
            placeholder="添加地点（可选）"
            value={form.location}
            onChange={e => set('location', e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 分类选择 - 横向标签风格 */}
          <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              日程分类
            </div>
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('category', opt.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
                  style={{
                    backgroundColor: form.category === opt.key ? opt.color + '20' : 'var(--td-bg-color-component)',
                    color: form.category === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.category === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 优先级选择 */}
          <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              优先级
            </div>
            <div className="flex gap-2">
              {[
                { key: 'high', label: '高', bg: '#FEF2F2', color: '#EF4444' },
                { key: 'medium', label: '中', bg: '#FFFBEB', color: '#F59E0B' },
                { key: 'low', label: '低', bg: '#F0FDF4', color: '#10B981' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('priority', opt.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.priority === opt.key ? opt.bg : 'var(--td-bg-color-component)',
                    color: form.priority === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.priority === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 日程表来源 - 与左侧同步 */}
          {activeCalendars && activeCalendars.length > 0 && (
            <div>
              <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
                所属日程表
              </div>
              <div className="flex flex-wrap gap-2">
                {activeCalendars.map(cal => (
                  <button
                    key={cal.id}
                    onClick={() => set('calendarId', cal.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
                    style={{
                      backgroundColor: form.calendarId === cal.id ? cal.color + '20' : 'var(--td-bg-color-component)',
                      color: form.calendarId === cal.id ? cal.color : 'var(--td-text-color-secondary)',
                      border: `1.5px solid ${form.calendarId === cal.id ? cal.color : 'transparent'}`,
                    }}
                  >
                    <span className="calendar-color-dot" style={{ backgroundColor: cal.color }} />
                    <span>{cal.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 备注 */}
          <textarea
            placeholder="添加备注（可选）"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 循环设置 */}
          {!isUnscheduled && <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              循环重复
            </div>
            <div className="flex gap-2">
              {[
                { key: '', label: '不重复', color: '#6B7280' },
                { key: 'daily', label: '每日', color: '#3B82F6' },
                { key: 'weekly', label: '每周', color: '#10B981' },
                { key: 'monthly', label: '每月', color: '#8B5CF6' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('repeat', opt.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.repeat === opt.key ? opt.color + '20' : 'var(--td-bg-color-component)',
                    color: form.repeat === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.repeat === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>}
          </div>}
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!form.title.trim()}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: form.title.trim() ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
              color: form.title.trim() ? '#fff' : 'var(--td-text-color-disabled)',
            }}
          >
            {isEditing ? '保存修改' : '添加日程'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 小日程卡片（带优先级颜色） ====================

function ScheduleChip({
  schedule,
  compact = false,
  onToggle,
  onDelete,
  onEdit,
  onClick,
  calendar,
}: {
  schedule: Schedule;
  compact?: boolean;
  onToggle?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (s: Schedule) => void;
  onClick?: (s: Schedule) => void;
  calendar?: { id: string; name: string; color: string; icon: string };
}) {
  const pColor = PRIORITY_COLORS[schedule.priority] || PRIORITY_COLORS.medium;
  const catColor = CATEGORY_COLORS[schedule.category] || '#6B7280';

  if (compact) {
    return (
      <div
        data-schedule-id={schedule.id}
        tabIndex={0}
        className="rounded px-1.5 py-0.5 text-xs cursor-pointer truncate mb-0.5 flex items-center gap-1"
        style={{
          backgroundColor: `${pColor.dot}20`,
          color: pColor.dot,
          borderLeft: `2.5px solid ${pColor.dot}`,
          opacity: schedule.is_completed ? 0.5 : 1,
          textDecoration: schedule.is_completed ? 'line-through' : 'none',
        }}
        onClick={() => onClick?.(schedule)}
      >
        {/* 优先级小圆点 */}
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: pColor.dot }}
        />
        {schedule.type === 'todo' && <span className="opacity-70">◇</span>}
        {!schedule.all_day && <span className="opacity-70">{formatTime(schedule.start_time)}</span>}
        <span className="schedule-title-primary schedule-title-compact truncate">{schedule.title}</span>
        {/* 日程来源标签 */}
        {calendar && (
          <span
            className="rounded px-0.5 flex-shrink-0"
            style={{ 
              border: `1px solid ${calendar.color}`,
              fontSize: '8px',
            }}
            title={calendar.name}
          >
            <span className="calendar-color-dot" style={{ backgroundColor: calendar.color }} />
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      data-schedule-id={schedule.id}
      tabIndex={0}
      className="group rounded-xl p-3 cursor-pointer transition-all hover:shadow-sm relative"
      style={{
        background: `linear-gradient(135deg, ${pColor.dot}12, ${catColor}08)`,
        border: `1px solid ${pColor.dot}40`,
        opacity: schedule.is_completed ? 0.6 : 1,
      }}
      onClick={() => onClick?.(schedule)}
    >
      {/* 左侧优先级颜色条 */}
      <div
        className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
        style={{ backgroundColor: pColor.dot }}
      />
      <div className="pl-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              onClick={e => { e.stopPropagation(); onToggle?.(schedule.id); }}
              className="flex-shrink-0 transition-transform hover:scale-110"
              style={{ color: schedule.is_completed ? '#10B981' : '#9CA3AF' }}
            >
              {schedule.is_completed
                ? <CheckCircle2 className="w-4 h-4" />
                : <Circle className="w-4 h-4" />}
            </button>
            <span
              className="schedule-title-primary text-sm font-semibold"
              style={{
                color: schedule.is_completed ? '#9CA3AF' : 'var(--td-text-color-primary)',
                textDecoration: schedule.is_completed ? 'line-through' : 'none',
              }}
            >
              {schedule.is_completed && <span className="text-green-500 mr-1">✓</span>}
              {schedule.title}
            </span>
            {/* 优先级标签 */}
            <span
              className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium"
              style={{ backgroundColor: `${pColor.dot}18`, color: pColor.dot }}
            >
              {pColor === PRIORITY_COLORS.high ? '高' : pColor === PRIORITY_COLORS.low ? '低' : '中'}
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: `${catColor}18`, color: catColor }}
            >
              {schedule.type === 'todo' ? '待办' : CATEGORY_LABELS[schedule.category]}
            </span>
            {/* 日程来源标签 */}
            {calendar && (
              <span
                className="text-xs px-1 py-0.5 rounded flex-shrink-0 font-medium"
                style={{ 
                  border: `1px solid ${calendar.color}`,
                  color: calendar.color,
                }}
                title={calendar.name}
              >
                <span className="calendar-color-dot" style={{ backgroundColor: calendar.color }} />{calendar.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); onEdit?.(schedule); }}
              className="p-1 rounded hover:bg-blue-50"
              style={{ color: '#3B82F6' }}
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete?.(schedule.id); }}
              className="p-1 rounded hover:bg-red-50"
              style={{ color: '#EF4444' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-1.5 pl-6">
          {!schedule.all_day && (
            <div className="flex items-center gap-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              <Clock className="w-3 h-3" />
              <span className="text-xs">
                {formatTime(schedule.start_time)}
                {schedule.end_time ? ` - ${formatTime(schedule.end_time)}` : ''}
              </span>
            </div>
          )}
          {schedule.all_day && (
            <div className="flex items-center gap-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              <Calendar className="w-3 h-3" />
              <span className="text-xs">全天</span>
            </div>
          )}
          {schedule.location && (
            <div className="flex items-center gap-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              <MapPin className="w-3 h-3" />
              <span className="text-xs truncate max-w-[160px]">{schedule.location}</span>
            </div>
          )}
        </div>

        {schedule.notes && (
          <div
            className="mt-2 pl-6 text-xs"
            style={{ color: 'var(--td-text-color-secondary)' }}
          >
            备注：{schedule.notes}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 日视图 ====================

function DayView({
  date, schedules, onToggle, onDelete, onEdit, onClickSchedule, conflictingIds, conflictMap, activeCalendars,
}: {
  date: Date;
  schedules: Schedule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (s: Schedule) => void;
  onClickSchedule: (s: Schedule) => void;
  conflictingIds?: Set<string>;
  conflictMap?: Map<string, Schedule[]>;
  activeCalendars?: Array<{ id: string; name: string; color: string; icon: string }>;
}) {
  const daySchedules = schedules.filter(s => isSameDay(parseLocalDate(s.start_time), date));
  // 分离全天事件和待办任务
  const allDayEvents = daySchedules.filter(s => s.all_day && s.type === 'event');
  // 【修复重叠】全天待办只显示在 Banner，有时间待办只显示在时间轴
  const allDayTodos = daySchedules.filter(s => s.all_day && s.type === 'todo');
  // 有时间的日程（只包含事件，不包含待办）
  const timedSchedules = daySchedules.filter(s => !s.all_day && s.type === 'event');
  const timedTodos = daySchedules.filter(s => !s.all_day && s.type === 'todo');

  const currentHour = new Date().getHours();
  const isToday = isSameDay(date, new Date());

  // 计算冲突日程在某小时内的分组
  const getConflictInfo = (schedule: Schedule) => {
    if (!conflictingIds?.has(schedule.id) || !conflictMap) {
      return null;
    }
    let slotIndex = 0;
    let slotCount = 1;
    let slotKey = '';
    
    for (const [key, schedules] of conflictMap.entries()) {
      const idx = schedules.findIndex(s => s.id === schedule.id);
      if (idx !== -1) {
        slotIndex = idx;
        slotCount = schedules.length;
        slotKey = key;
        break;
      }
    }
    
    return { slotIndex, slotCount, slotKey };
  };

  // 合并全天事件和全天待办（统一显示在一个Banner中）
  const allDayItems = [
    ...allDayEvents.map(s => ({ ...s, _isEvent: true })),
    ...allDayTodos.map(s => ({ ...s, _isEvent: false }))
  ];

  return (
    <div className="calendar-day-view flex flex-col h-full overflow-hidden">
      {/* 【改进】全天日程悬浮Banner - 统一显示全天事件和全天待办 */}
      {allDayItems.length > 0 && (
        <div
          className="mx-3 mt-3 rounded-xl px-4 py-3 flex-shrink-0 relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}
        >
          {/* 装饰背景 */}
          <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />
          
          {/* 标题 */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" style={{ color: '#3b82f6' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--td-brand-color)' }}>全天日程</span>
            </div>
            <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, rgba(59,130,246,0.3), transparent)' }} />
          </div>
          
          {/* 全天日程列表 - 横向滚动 */}
          <div className="flex flex-wrap gap-2">
            {allDayItems.map((s: any) => {
              const color = s._isEvent 
                ? (CATEGORY_COLORS[s.category] || '#6B7280')
                : (PRIORITY_COLORS[s.priority]?.dot || '#F59E0B');
              return (
                <div
                  key={s.id}
                  data-schedule-id={s.id}
                  tabIndex={0}
                  className="group px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all hover:scale-105 flex items-center gap-1.5"
                  style={{
                    backgroundColor: `${color}15`,
                    border: `1px solid ${color}40`,
                    boxShadow: `0 2px 8px ${color}10`,
                  }}
                  onClick={() => onClickSchedule(s)}
                  title={`点击查看详情${s.location ? ` · ${s.location}` : ''}`}
                >
                  {/* 待办勾选框 */}
                  {!s._isEvent && (
                    <button
                      onClick={e => { e.stopPropagation(); onToggle(s.id); }}
                      className="opacity-70 hover:opacity-100 flex-shrink-0 transition-transform hover:scale-110"
                    >
                      {s.is_completed 
                        ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#10b981' }} /> 
                        : <Circle className="w-3.5 h-3.5" style={{ color }} />
                      }
                    </button>
                  )}
                  <span 
                    className="schedule-title-primary truncate max-w-[150px]"
                    style={{ color, textDecoration: s.is_completed ? 'line-through' : 'none', opacity: s.is_completed ? 0.6 : 1 }}
                  >
                    {s.title}
                  </span>
                  {/* 地点 */}
                  {s.location && (
                    <span className="text-xs opacity-60 truncate max-w-[80px]" style={{ color }}>
                      <MapPin size={11} />{s.location}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {HOURS.map(hour => {
            const hourSchedules = timedSchedules.filter(s => getScheduleHour(s) === hour);
            // 待办任务显示在对应小时（固定1小时高度）
            const hourTodos = timedTodos.filter(s => getScheduleHour(s) === hour);
            // 待办和事件分开显示，不合并
            
            return (
              <div
                key={hour}
                className="flex border-b"
                style={{ borderColor: 'var(--td-component-stroke)', minHeight: '56px', position: 'relative' }}
              >
                <div
                  className="w-14 flex-shrink-0 text-right pr-3 pt-1 text-xs select-none"
                  style={{ color: 'var(--td-text-color-placeholder)' }}
                >
                  {String(hour).padStart(2, '0')}:00
                </div>

                {/* 待办区域 - 固定宽度，垂直排列 */}
                {hourTodos.length > 0 && (
                  <div className="flex-shrink-0 w-36 border-r pr-1 flex flex-col gap-1 py-0.5" 
                    style={{ borderColor: 'var(--td-component-stroke)' }}>
                    {hourTodos.map(s => {
                      const pColor = PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.medium;
                      const catColor = CATEGORY_COLORS[s.category] || '#6B7280';
                      
                      return (
                        <div
                          key={s.id}
                          data-schedule-id={s.id}
                          tabIndex={0}
                          className="rounded-lg px-1.5 py-1 cursor-pointer overflow-hidden group flex-shrink-0"
                          style={{
                            height: '44px',
                            backgroundColor: s.is_completed ? 'var(--td-bg-color-component)' : `${pColor.dot}15`,
                            border: s.is_completed ? `1px solid var(--td-component-stroke)` : `1px dashed ${pColor.dot}50`,
                            borderLeft: s.is_completed ? `3px solid #9CA3AF` : `3px dashed ${pColor.dot}`,
                            opacity: s.is_completed ? 0.65 : 1,
                          }}
                          onClick={() => onClickSchedule(s)}
                        >
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={e => { e.stopPropagation(); onToggle(s.id); }}
                              className="opacity-60 hover:opacity-100 flex-shrink-0"
                            >
                              {s.is_completed ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Circle className="w-3 h-3" style={{ color: pColor.dot }} />}
                            </button>
                            <span className="schedule-title-primary schedule-title-compact truncate" style={{ color: s.is_completed ? '#9CA3AF' : pColor.dot }}>
                              {s.title}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 事件区域 - 占据剩余空间 */}
                <div className="flex-1 py-1 pr-3 pl-1 relative">
                  {isToday && hour === currentHour && (
                    <div
                      className="absolute left-0 right-0 flex items-center z-10"
                      style={{ top: `${(new Date().getMinutes() / 60) * 100}%` }}
                    >
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 -ml-1" style={{ backgroundColor: '#EF4444' }} />
                      <div className="flex-1 h-px" style={{ backgroundColor: '#EF4444' }} />
                    </div>
                  )}

                  {hourSchedules.map(s => {
                    const isTodo = s.type === 'todo';
                    const durationMin = getDurationMinutes(s);
                    const topPercent = (getScheduleMinute(s) / 60) * 100;
                    const pColor = PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.medium;

                    // 类别标签配置
                    const catColor = CATEGORY_COLORS[s.category] || '#6B7280';
                    const catLabel = CATEGORY_LABELS[s.category] || '其他';

                    // 冲突信息
                    const isConflicting = conflictingIds?.has(s.id) || false;
                    const conflictInfo = isConflicting ? getConflictInfo(s) : null;
                    const isNarrowCard = conflictInfo && conflictInfo.slotCount > 5;
                    
                    // 计算布局位置和宽度（冲突日程从左到右排列）
                    const cardWidth = conflictInfo ? Math.max(4, 100 / conflictInfo.slotCount) : 100;
                    const leftPos = conflictInfo ? Math.max(0, conflictInfo.slotIndex * (100 / conflictInfo.slotCount)) : 0;

                    // 计算卡片高度
                    const baseHeight = 48;
                    const heightPer30Min = 20;
                    const calculatedHeight = baseHeight + Math.min(durationMin, 120) / 30 * heightPer30Min;
                    const notesLines = durationMin >= 90 ? 3 : durationMin >= 60 ? 2 : 1;

                    return (
                      <div
                        key={s.id}
                        data-schedule-id={s.id}
                        tabIndex={0}
                        className="absolute rounded-lg px-1 py-0.5 cursor-pointer overflow-hidden group"
                        style={{
                          top: `${topPercent}%`,
                          left: `${leftPos}%`,
                          width: `${cardWidth}%`,
                          minHeight: '32px',
                          height: `${calculatedHeight}px`,
                          maxHeight: `${Math.max(50, (Math.min(durationMin, 120) / 60) * 60)}px`,
                          backgroundColor: s.is_completed ? 'var(--td-bg-color-component)' : `${pColor.dot}20`,
                          border: s.is_completed ? `1px solid var(--td-component-stroke)` : `1px solid ${pColor.dot}50`,
                          borderLeft: s.is_completed ? `3px solid #9CA3AF` : `3px solid ${pColor.dot}`,
                          opacity: s.is_completed ? 0.65 : 1,
                          // 冲突日程添加红色边框高亮
                          zIndex: isConflicting ? 5 : 1,
                        }}
                        onClick={() => onClickSchedule(s)}
                      >
                        <div className="flex items-start justify-between h-full overflow-hidden">
                          <div className="min-w-0 flex-1 overflow-hidden">
                            {/* 冲突惊叹号标记 */}
                            {isConflicting && (
                              <span 
                                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full mr-0.5 flex-shrink-0 text-white font-bold text-xs absolute -top-0.5 -left-0.5 z-10"
                                style={{ backgroundColor: '#EF4444' }}
                                title="时间冲突"
                              >
                                !
                              </span>
                            )}
                            <div
                              className="text-xs font-semibold truncate flex items-center gap-0.5"
                              style={{ color: s.is_completed ? '#9CA3AF' : pColor.dot, textDecoration: s.is_completed ? 'line-through' : 'none' }}
                            >
                              {s.is_completed && <span className="text-green-500">✓</span>}
                              {/* 待办标记 */}
                              {isTodo && <span className="opacity-70">◇</span>}
                              {/* 时间显示 */}
                              {!isNarrowCard && !s.all_day && (
                                <span className="opacity-70">{formatTime(s.start_time)}</span>
                              )}
                              {/* 类别小标签 - 窄卡片时隐藏，待办不显示类别 */}
                              {!isNarrowCard && !isTodo && (
                                <span
                                  className="text-xs px-1 py-0 rounded flex-shrink-0 font-medium"
                                  style={{ backgroundColor: `${catColor}25`, color: catColor, fontSize: '8px' }}
                                >
                                  {catLabel}
                                </span>
                              )}
                              <span className="schedule-title-primary schedule-title-compact truncate">{s.title}</span>
                              {/* 日程来源标签 - 窄卡片时隐藏 */}
                              {!isNarrowCard && (
                                (() => {
                                  const cal = activeCalendars?.find(c => c.id === s.calendar_id);
                                  if (!cal) return null;
                                  return (
                                    <span
                                      className="px-1 py-0 rounded flex-shrink-0 font-medium"
                                      style={{ 
                                        backgroundColor: 'transparent', 
                                        color: '#666',
                                        border: `1px solid ${cal.color}`,
                                        fontSize: '7px',
                                      }}
                                      title={cal.name}
                                    >
                                      <span className="calendar-color-dot" style={{ backgroundColor: cal.color }} />{cal.name.slice(0, 2)}
                                    </span>
                                  );
                                })()
                              )}
                            </div>
                            {/* 日视图显示地点 - 窄卡片时隐藏 */}
                            {!isNarrowCard && s.location && (
                              <div className="text-xs opacity-70 truncate flex items-center gap-0.5" style={{ color: s.is_completed ? '#9CA3AF' : pColor.dot }}>
                                <MapPin className="w-2 h-2 flex-shrink-0" />
                                <span className="truncate">{s.location}</span>
                              </div>
                            )}
                            {/* 日视图显示备注 - 窄卡片时隐藏，根据时长动态显示行数 */}
                            {!isNarrowCard && s.notes && (
                              <div 
                                className={`text-xs opacity-75 line-clamp-${notesLines} flex items-start gap-0.5`} 
                                style={{ color: s.is_completed ? '#9CA3AF' : 'var(--td-text-color-secondary)' }}
                              >
                                <span className="flex-shrink-0">备注</span>
                                <span className="truncate">{s.notes}</span>
                              </div>
                            )}
                          </div>
                          {/* 操作按钮 - 窄卡片时隐藏 */}
                          {!isNarrowCard && (
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0 ml-0.5">
                              <button
                                onClick={e => { e.stopPropagation(); onEdit(s); }}
                                className="p-0.5 rounded"
                                style={{ color: '#3B82F6' }}
                              >
                                <Edit3 className="w-2 h-2" />
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); onDelete(s.id); }}
                                className="p-0.5 rounded"
                                style={{ color: '#EF4444' }}
                              >
                                <Trash2 className="w-2 h-2" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ==================== 周视图 ====================

function WeekView({
  weekStart, schedules, onToggle, onDelete, onEdit, onClickSchedule, onClickDay, conflictingIds, activeCalendars, showLunar, showFestivals,
}: {
  weekStart: Date;
  schedules: Schedule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (s: Schedule) => void;
  onClickSchedule: (s: Schedule) => void;
  onClickDay: (d: Date) => void;
  conflictingIds?: Set<string>;
  activeCalendars?: Array<{ id: string; name: string; color: string; icon: string }>;
  showLunar?: boolean;
  showFestivals?: boolean;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const today = new Date();

  // 计算每天的全天事件、全天待办、有时间待办（只计算未完成的）
  const getDayAllDayEvents = (day: Date) => schedules.filter(s => s.all_day && s.type === 'event' && isSameDay(parseLocalDate(s.start_time), day));
  const getDayAllDayTodos = (day: Date) => schedules.filter(s => s.all_day && s.type === 'todo' && !s.is_completed && isSameDay(parseLocalDate(s.start_time), day));
  const getDayTimedTodos = (day: Date) => schedules.filter(s => !s.all_day && s.type === 'todo' && !s.is_completed && isSameDay(parseLocalDate(s.start_time), day));
  const getDayAllItems = (day: Date) => [
    ...getDayAllDayEvents(day).map(s => ({ ...s, _isAllDay: true })),
    ...getDayAllDayTodos(day).map(s => ({ ...s, _isAllDay: true }))
  ];

  return (
    <div className="calendar-week-view flex flex-col h-full overflow-hidden">
      {/* 周头部 */}
      <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid var(--td-component-stroke)' }}>
        <div className="w-14 flex-shrink-0" />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today);
          const todoCount = getDayTimedTodos(day).length; // 只显示待办的红点
          const dayMeta = getCalendarDayMeta(day);
          const dayMetaLabel = showFestivals && (dayMeta.festivals[0] || dayMeta.solarTerm)
            ? (dayMeta.festivals[0] || dayMeta.solarTerm)
            : showLunar ? dayMeta.lunarLabel : '';
          return (
            <div
              key={i}
              className="flex-1 text-center py-2 cursor-pointer hover:opacity-70 transition-opacity"
              onClick={() => onClickDay(day)}
            >
              <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>周{WEEK_DAYS[i]}</div>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold mx-auto relative"
                style={{
                  backgroundColor: isToday ? 'var(--td-brand-color)' : 'transparent',
                  color: isToday ? '#fff' : 'var(--td-text-color-primary)',
                }}
              >
                {day.getDate()}
                {/* 只显示待办的红点，不显示全天日程的红点 */}
                {todoCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs"
                    style={{ backgroundColor: '#EF4444', color: '#fff', fontSize: '9px' }}
                  >
                    {todoCount}
                  </span>
                )}
              </div>
              {dayMetaLabel && <div className="calendar-cell-meta">{dayMetaLabel}</div>}
            </div>
          );
        })}
      </div>

      {/* 【改进】全天事件+全天待办悬浮Banner行 */}
      <div className="flex flex-shrink-0 border-b relative overflow-hidden" style={{ 
        borderColor: 'rgba(59, 130, 246, 0.2)', 
        minHeight: '36px', 
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(139, 92, 246, 0.05) 100%)'
      }}>
        <div className="w-14 flex-shrink-0 text-right pr-3 pt-1 text-xs select-none flex items-center justify-end" style={{ color: '#3b82f6' }}>
          <Calendar className="w-3 h-3 mr-1" />
          <span className="font-medium">全天</span>
        </div>
        {days.map((day, di) => {
          const allDayItems = getDayAllItems(day);
          return (
            <div
              key={di}
              className="flex-1 border-l py-0.5 px-1 min-h-[36px]"
              style={{ borderColor: 'rgba(59, 130, 246, 0.1)' }}
            >
              {allDayItems.map(item => {
                const isTodo = item.type === 'todo';
                const color = isTodo 
                  ? (PRIORITY_COLORS[item.priority]?.dot || '#F59E0B')
                  : (CATEGORY_COLORS[item.category] || '#6B7280');
                return (
                  <div
                    key={item.id}
                    data-schedule-id={item.id}
                    tabIndex={0}
                    className="rounded-md px-1.5 py-0.5 cursor-pointer text-xs truncate mb-0.5 flex items-center gap-1 transition-all hover:scale-105"
                    style={{
                      backgroundColor: `${color}18`,
                      color: color,
                      border: `1px solid ${color}35`,
                      boxShadow: `0 1px 4px ${color}08`,
                    }}
                    onClick={() => onClickSchedule(item)}
                    title={`点击查看详情${item.location ? ` · ${item.location}` : ''}`}
                  >
                    {isTodo && (
                      <button
                        onClick={e => { e.stopPropagation(); onToggle(item.id); }}
                        className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                      >
                        {item.is_completed ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                      </button>
                    )}
                    <span className="schedule-title-primary schedule-title-compact truncate">{item.title}</span>
                  </div>
                );
              })}
              {/* 无全天日程时显示占位提示 */}
              {allDayItems.length === 0 && (
                <div className="h-5" />
              )}
            </div>
          );
        })}
      </div>

      {/* 有时间待办行 */}
      <div className="flex flex-shrink-0 border-b" style={{ borderColor: 'var(--td-component-stroke)', minHeight: '32px' }}>
        <div className="w-14 flex-shrink-0 text-right pr-3 pt-1 text-xs select-none flex items-center justify-end" style={{ color: 'var(--td-text-color-placeholder)' }}>
          <CheckCircle2 className="w-3 h-3 mr-1" />
          待办
        </div>
        {days.map((day, di) => {
          const timedTodos = getDayTimedTodos(day);
          return (
            <div
              key={di}
              className="flex-1 border-l py-0.5 px-0.5"
              style={{ borderColor: 'var(--td-component-stroke)' }}
            >
              {timedTodos.map(s => (
                <div
                  key={s.id}
                  data-schedule-id={s.id}
                  tabIndex={0}
                  className="rounded px-1 py-0.5 cursor-pointer text-xs truncate mb-0.5 flex items-center gap-1"
                  style={{
                    backgroundColor: `${PRIORITY_COLORS[s.priority]?.dot || '#F59E0B'}15`,
                    color: PRIORITY_COLORS[s.priority]?.dot || '#F59E0B',
                  }}
                  onClick={() => onClickSchedule(s)}
                >
                  <button
                    onClick={e => { e.stopPropagation(); onToggle(s.id); }}
                    className="flex-shrink-0"
                  >
                    {s.is_completed ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                  </button>
                  <span className="opacity-70">{formatTime(s.start_time)}</span>
                  <span className="schedule-title-primary schedule-title-compact truncate">{s.title}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {HOURS.map(hour => (
            <div
              key={hour}
              className="flex"
              style={{ borderBottom: '1px solid var(--td-component-stroke)', minHeight: '48px' }}
            >
              <div
                className="w-14 flex-shrink-0 text-right pr-3 pt-1 text-xs select-none"
                style={{ color: 'var(--td-text-color-placeholder)' }}
              >
                {String(hour).padStart(2, '0')}:00
              </div>
              {days.map((day, di) => {
                const daySchedules = schedules.filter(
                  s => !s.all_day && s.type === 'event' && isSameDay(new Date(s.start_time), day)
                    && getScheduleHour(s) === hour
                );
                return (
                  <div
                    key={di}
                    className="flex-1 border-l py-0.5 px-0.5"
                    style={{ borderColor: 'var(--td-component-stroke)' }}
                  >
                    {daySchedules.map(s => {
                      const pColor = PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.medium;
                      const isConflicting = conflictingIds?.has(s.id);
                      return (
                        <div
                          key={s.id}
                          data-schedule-id={s.id}
                          tabIndex={0}
                          className="rounded px-1 py-0.5 cursor-pointer text-xs truncate mb-0.5 flex items-center gap-1"
                          style={{
                            backgroundColor: `${pColor.dot}22`,
                            borderLeft: `2.5px solid ${pColor.dot}`,
                            color: pColor.dot,
                            opacity: s.is_completed ? 0.5 : 1,
                          }}
                          onClick={() => onClickSchedule(s)}
                        >
                          {/* 冲突标记 */}
                          {isConflicting && (
                            <span 
                              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full flex-shrink-0 text-white font-bold text-xs"
                              style={{ backgroundColor: '#EF4444', fontSize: '9px' }}
                              title="时间冲突"
                            >
                              !
                            </span>
                          )}
                          <span className="opacity-70">{formatTime(s.start_time)}</span><span className="schedule-title-primary schedule-title-compact truncate">{s.title}</span>
                          {/* 日程来源标签 */}
                          {(() => {
                            const cal = activeCalendars?.find(c => c.id === s.calendar_id);
                            if (!cal) return null;
                            return (
                              <span
                                className="rounded px-0.5 flex-shrink-0"
                                style={{ 
                                  border: `1px solid ${cal.color}`,
                                  fontSize: '7px',
                                }}
                                title={cal.name}
                              >
                                <span className="calendar-color-dot" style={{ backgroundColor: cal.color }} />
                              </span>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== 月视图 ====================

function MonthView({
  year, month, schedules, selectedDate, onSelectDate, onToggle, onClickSchedule, conflictingIds, activeCalendars, showLunar, showFestivals,
}: {
  year: number;
  month: number;
  schedules: Schedule[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onToggle?: (id: string) => void;
  onClickSchedule?: (s: Schedule) => void;
  conflictingIds?: Set<string>;
  activeCalendars?: Array<{ id: string; name: string; color: string; icon: string }>;
  showLunar?: boolean;
  showFestivals?: boolean;
}) {
  const dates = getMonthDates(year, month);
  const today = new Date();

  // 计算每天的全天事件、全天待办、有时间待办（只计算未完成的）
  const getDayAllDayEvents = (day: Date) => schedules.filter(s => s.all_day && s.type === 'event' && isSameDay(parseLocalDate(s.start_time), day));
  const getDayAllDayTodos = (day: Date) => schedules.filter(s => s.all_day && s.type === 'todo' && !s.is_completed && isSameDay(parseLocalDate(s.start_time), day));
  const getDayTimedTodos = (day: Date) => schedules.filter(s => !s.all_day && s.type === 'todo' && !s.is_completed && isSameDay(parseLocalDate(s.start_time), day));
  const getDayTimedEvents = (day: Date) => schedules.filter(s => !s.all_day && s.type === 'event' && isSameDay(parseLocalDate(s.start_time), day));
  const getDayAllItems = (day: Date) => [
    ...getDayAllDayEvents(day),
    ...getDayAllDayTodos(day)
  ];

  return (
    <div className="calendar-month-view h-full overflow-auto px-2 pb-4">
      <div className="grid grid-cols-7 mb-1 sticky top-0 pt-2 z-10" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
        {WEEK_DAYS.map(d => (
          <div key={d} className="text-center text-xs py-1 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
            周{d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {dates.map((date, i) => {
          const isCurrentMonth = date.getMonth() === month;
          const isToday = isSameDay(date, today);
          const isSelected = isSameDay(date, selectedDate);
          const allDayItems = getDayAllItems(date);
          const timedTodos = getDayTimedTodos(date);
          const timedEvents = getDayTimedEvents(date);
          const maxShow = 2;
          const dayMeta = getCalendarDayMeta(date);
          const dayMetaLabel = showFestivals && (dayMeta.festivals[0] || dayMeta.solarTerm)
            ? (dayMeta.festivals[0] || dayMeta.solarTerm)
            : showLunar ? dayMeta.lunarLabel : '';

          return (
            <div
              key={i}
              className="min-h-[100px] rounded-xl p-1 cursor-pointer transition-all hover:shadow-sm"
              style={{
                backgroundColor: isSelected
                  ? 'var(--td-brand-color-light)'
                  : isToday
                    ? 'var(--td-warning-color-light, rgba(245, 158, 11, 0.08))'
                    : 'var(--td-bg-color-component)',
                border: isSelected
                  ? '1.5px solid var(--td-brand-color)'
                  : isToday
                    ? '1.5px solid #F59E0B'
                    : '1px solid transparent',
                opacity: isCurrentMonth ? 1 : 0.4,
              }}
              onClick={() => onSelectDate(date)}
            >
              <div
                className="text-xs font-semibold mb-1 text-center w-6 h-6 rounded-full flex items-center justify-center mx-auto"
                style={{
                  backgroundColor: isToday ? '#F59E0B' : 'transparent',
                  color: isToday ? '#fff' : isSelected
                    ? 'var(--td-brand-color)'
                    : 'var(--td-text-color-primary)',
                }}
              >
                {date.getDate()}
              </div>
              {dayMetaLabel && <div className="calendar-cell-meta month">{dayMetaLabel}</div>}

              {/* 【改进】全天事件+全天待办悬浮Banner区域 */}
              {allDayItems.length > 0 && (
                <div className="mb-1 rounded-md p-1" style={{
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%)',
                  border: '1px solid rgba(59, 130, 246, 0.15)',
                }}>
                  {allDayItems.slice(0, 2).map(item => {
                    const isTodo = item.type === 'todo';
                    const color = isTodo 
                      ? (PRIORITY_COLORS[item.priority]?.dot || '#F59E0B')
                      : (CATEGORY_COLORS[item.category] || '#6B7280');
                    return (
                      <div
                        key={item.id}
                        data-schedule-id={item.id}
                        tabIndex={0}
                        className="rounded px-1 py-0.5 text-xs truncate cursor-pointer flex items-center gap-0.5 transition-all hover:scale-105"
                        style={{
                          backgroundColor: `${color}20`,
                          color: color,
                          border: `1px solid ${color}35`,
                        }}
                        onClick={event => { event.stopPropagation(); onClickSchedule?.(item); }}
                        title={item.title}
                      >
                        {isTodo && (
                          <button
                            onClick={e => { e.stopPropagation(); onToggle?.(item.id); }}
                            className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                          >
                            {item.is_completed ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Circle className="w-2.5 h-2.5" />}
                          </button>
                        )}
                        <span className="schedule-title-primary schedule-title-compact truncate">{item.title}</span>
                      </div>
                    );
                  })}
                  {allDayItems.length > 2 && (
                    <div className="text-xs px-1 font-medium" style={{ color: '#3b82f6' }}>
                      +{allDayItems.length - 2}个全天日程
                    </div>
                  )}
                </div>
              )}

              {/* 有时间待办区域 */}
              {timedTodos.length > 0 && (
                <div className="mb-1">
                  {timedTodos.slice(0, 1).map(s => (
                    <div
                      key={s.id}
                      data-schedule-id={s.id}
                      tabIndex={0}
                      className="rounded px-1 py-0.5 text-xs truncate cursor-pointer flex items-center gap-0.5"
                      style={{
                        backgroundColor: `${PRIORITY_COLORS[s.priority]?.dot || '#F59E0B'}15`,
                        color: PRIORITY_COLORS[s.priority]?.dot || '#F59E0B',
                      }}
                      onClick={event => { event.stopPropagation(); onClickSchedule?.(s); }}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); onToggle?.(s.id); }}
                        className="flex-shrink-0"
                      >
                        {s.is_completed ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Circle className="w-2.5 h-2.5" />}
                      </button>
                      <span className="opacity-70 text-[10px]">{formatTime(s.start_time)}</span>
                      <span className="schedule-title-primary schedule-title-compact truncate">{s.title}</span>
                    </div>
                  ))}
                  {timedTodos.length > 1 && (
                    <div className="text-xs px-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      +{timedTodos.length - 1}个待办
                    </div>
                  )}
                </div>
              )}

              {/* 有时间的日程 */}
              <div>
                {timedEvents.slice(0, maxShow).map(s => {
                  const isConflicting = conflictingIds?.has(s.id);
                  return (
                    <div key={s.id} className="flex items-center gap-0.5">
                      {/* 冲突标记 */}
                      {isConflicting && (
                        <span 
                          className="inline-flex items-center justify-center w-3 h-3 rounded-full flex-shrink-0 text-white font-bold text-xs"
                          style={{ backgroundColor: '#EF4444', fontSize: '8px' }}
                          title="时间冲突"
                        >
                          !
                        </span>
                      )}
                      <ScheduleChip schedule={s} compact onClick={onClickSchedule} calendar={activeCalendars?.find(c => c.id === s.calendar_id)} />
                    </div>
                  );
                })}
                {timedEvents.length > maxShow && (
                  <div className="text-xs px-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    +{timedEvents.length - maxShow} 项
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 详情弹窗 ====================

function ScheduleDetailModal({
  schedule,
  onClose,
  onDelete,
  onToggle,
  onEdit,
  calendar,
}: {
  schedule: Schedule;
  onClose: () => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit: (s: Schedule) => void;
  calendar?: { id: string; name: string; color: string; icon: string };
}) {
  const pColor = PRIORITY_COLORS[schedule.priority] || PRIORITY_COLORS.medium;
  const catColor = CATEGORY_COLORS[schedule.category] || '#6B7280';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onMouseDown={onClose}
    >
      <div
        className="rounded-2xl p-5 w-full max-w-sm shadow-2xl"
        style={{ backgroundColor: 'var(--td-bg-color-container)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${catColor}20`, color: catColor }}
              >
                {schedule.type === 'todo' ? '待办' : CATEGORY_LABELS[schedule.category]}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${pColor.dot}18`, color: pColor.dot }}
              >
                {PRIORITY_COLORS[schedule.priority]?.label || '中优先'}
              </span>
            </div>
            <h3 className="schedule-title-primary text-base font-bold">
              {schedule.title}
              {/* 日程来源标签 */}
              {calendar && (
                <span
                  className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ 
                    border: `1px solid ${calendar.color}`,
                    color: calendar.color,
                  }}
                  title={calendar.name}
                >
                  <span className="calendar-color-dot" style={{ backgroundColor: calendar.color }} /> {calendar.name}
                </span>
              )}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-60 ml-2">
            <X className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
            <Clock className="w-4 h-4" />
            {schedule.all_day
              ? '全天'
              : `${formatTime(schedule.start_time)}${schedule.end_time ? ' - ' + formatTime(schedule.end_time) : ''}`
            }
          </div>
          {schedule.location && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              <MapPin className="w-4 h-4" />
              {schedule.location}
            </div>
          )}
          {schedule.notes && (
            <div className="mt-2 p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}>
              备注：{schedule.notes}
            </div>
          )}
          {schedule.description && (
            <div className="text-sm mt-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              {schedule.description}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { onDelete(schedule.id); onClose(); }}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#FEF2F2', color: '#EF4444' }}
          >
            <Trash2 className="w-3.5 h-3.5" />删除
          </button>
          <button
            onClick={() => { onToggle(schedule.id); onClose(); }}
            className="flex-1 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-brand-color-light)', color: 'var(--td-brand-color)' }}
          >
            {schedule.is_completed ? '标记未完成' : '标记完成'}
          </button>
          <button
            onClick={() => { onEdit(schedule); onClose(); }}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
          >
            <Edit3 className="w-3.5 h-3.5" />编辑
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

export interface CalendarViewProps {
  refreshKey?: number;
  activeCalendarIds?: string[];
  openScheduleRequest?: { id: string; nonce: number } | null;
  openScheduleMenuRequest?: { id: string; x: number; y: number; nonce: number } | null;
  selectedDate?: Date;
  onSelectedDateChange?: (date: Date) => void;
  showLunar?: boolean;
  showFestivals?: boolean;
  onOpenRail?: () => void;
  isRailOpen?: boolean;
}

export function CalendarView({
  refreshKey = 0,
  activeCalendarIds,
  openScheduleRequest,
  openScheduleMenuRequest,
  selectedDate,
  onSelectedDateChange,
  showLunar = true,
  showFestivals = true,
  onOpenRail,
  isRailOpen = false,
}: CalendarViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('agenda');
  const [currentDate, setCurrentDate] = useState<Date>(selectedDate || new Date());
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string; color: string; icon: string }>>([]);
  const [loading, setLoading] = useState(false);
  const { authHeaders } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [notifPermission, setNotifPermission] = useState<string>('default');
  const [contextMenu, setContextMenu] = useState<{ schedule: Schedule; x: number; y: number } | null>(null);

  const updateCurrentDate = useCallback((date: Date) => {
    const next = new Date(date);
    setCurrentDate(next);
    onSelectedDateChange?.(next);
  }, [onSelectedDateChange]);

  useEffect(() => {
    if (!selectedDate || isSameDay(selectedDate, currentDate)) return;
    setCurrentDate(new Date(selectedDate));
  }, [selectedDate?.getTime()]);

  // 获取日程表列表
  useEffect(() => {
    fetch('/api/calendars', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setCalendars(d.calendars || []))
      .catch(() => {});
  }, []);

  // 请求通知权限
  useEffect(() => {
    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const requestNotifPermission = async () => {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    }
  };

  // 设置提醒通知
  const scheduleReminder = useCallback((s: Schedule) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!s.reminders || s.reminders.length === 0) return;
    const minutesBefore = parseInt(s.reminders[0]) || 0;
    if (!minutesBefore) return;
    const startMs = new Date(s.start_time).getTime();
    const nowMs = Date.now();
    const triggerMs = startMs - minutesBefore * 60 * 1000;
    const delay = triggerMs - nowMs;
    if (delay > 0 && delay < 24 * 3600 * 1000) {
      setTimeout(() => {
        new Notification(s.title, {
          body: `${minutesBefore} 分钟后开始${s.location ? ' · ' + s.location : ''}`,
          icon: '/favicon.ico',
        });
      }, delay);
    }
  }, []);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/schedules', { headers: authHeaders() });
      const data = await res.json();
      const list: Schedule[] = data.schedules || [];
      setSchedules(list);
      // 为有提醒设置的日程注册通知
      list.forEach(s => scheduleReminder(s));
    } catch (e) {
      console.error('Fetch schedules failed', e);
    } finally {
      setLoading(false);
    }
  }, [scheduleReminder]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules, refreshKey]);

  useEffect(() => {
    if (!openScheduleRequest) return;
    let cancelled = false;
    fetch(`/api/schedules/${openScheduleRequest.id}`, { headers: authHeaders() })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (cancelled || !data?.schedule) return;
        const schedule = data.schedule as Schedule;
        updateCurrentDate(new Date(schedule.start_time));
        setEditingSchedule(null);
        setSelectedSchedule(schedule);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [openScheduleRequest?.nonce, updateCurrentDate]);

  useEffect(() => {
    if (!openScheduleMenuRequest) return;
    let cancelled = false;
    fetch('/api/schedules/' + openScheduleMenuRequest.id, { headers: authHeaders() })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (cancelled || !data?.schedule) return;
        setContextMenu({ schedule: data.schedule as Schedule, x: openScheduleMenuRequest.x, y: openScheduleMenuRequest.y });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [openScheduleMenuRequest?.nonce]);

  // 根据激活的日程表过滤
  const visibleSchedules = ((activeCalendarIds && activeCalendarIds.length > 0)
    ? schedules.filter(s => activeCalendarIds.includes(s.calendar_id))
    : schedules).filter(schedule => !schedule.is_unscheduled);

  const navigatePrev = () => {
    const d = new Date(currentDate);
    if (viewMode === 'day') d.setDate(d.getDate() - 1);
    else if (viewMode === 'week') d.setDate(d.getDate() - 7);
    else { d.setMonth(d.getMonth() - 1); d.setDate(1); }
    updateCurrentDate(d);
    setContextMenu(null);
  };

  const navigateNext = () => {
    const d = new Date(currentDate);
    if (viewMode === 'day') d.setDate(d.getDate() + 1);
    else if (viewMode === 'week') d.setDate(d.getDate() + 7);
    else { d.setMonth(d.getMonth() + 1); d.setDate(1); }
    updateCurrentDate(d);
    setContextMenu(null);
  };

  const goToday = () => {
    updateCurrentDate(new Date());
    setContextMenu(null);
  };

  const headerTitle = () => {
    if (viewMode === 'agenda' || viewMode === 'day') {
      return currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
        + ' · ' + WEEKDAY_LABELS[currentDate.getDay()];
    }
    if (viewMode === 'week') {
      const ws = getWeekStart(currentDate);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      return `${ws.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} - ${we.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
    }
    return currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  };

  const compactHeaderTitle = () => {
    if (viewMode === 'agenda' || viewMode === 'day') {
      return `${currentDate.getMonth() + 1}月${currentDate.getDate()}日 · ${currentDate.toLocaleDateString('zh-CN', { weekday: 'short' })}`;
    }
    if (viewMode === 'week') {
      const ws = getWeekStart(currentDate);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      return `${ws.getMonth() + 1}/${ws.getDate()}–${we.getMonth() + 1}/${we.getDate()}`;
    }
    return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;
  };

  const handleToggle = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/schedules/${id}/toggle`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.schedule) {
        setSchedules(prev => prev.map(s => s.id === id ? data.schedule : s));
      }
    } catch {}
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/schedules/${id}`, { method: 'DELETE', headers: authHeaders() });
      setSchedules(prev => prev.filter(s => s.id !== id));
    } catch {}
  }, []);

  const handleAddSchedule = async (form: Partial<Schedule>) => {
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          ...form,
          calendar_id: (activeCalendarIds && activeCalendarIds.length > 0) ? activeCalendarIds[0] : 'personal',
          category: form.category || 'other',
          priority: form.priority || 'medium',
          is_completed: false,
          is_repeated: false,
        })
      });
      const data = await res.json();
      if (data.schedule) {
        setSchedules(prev => [...prev, data.schedule]);
        // 为新日程设置提醒
        scheduleReminder(data.schedule);
      }
      setShowAddModal(false);
    } catch {}
  };

  const handleEditSchedule = async (form: Partial<Schedule>) => {
    if (!editingSchedule) return;
    try {
      const res = await fetch(`/api/schedules/${editingSchedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.schedule) {
        setSchedules(prev => prev.map(s => s.id === editingSchedule.id ? data.schedule : s));
        // 为更新的日程重新设置提醒
        scheduleReminder(data.schedule);
      }
      setEditingSchedule(null);
    } catch {}
  };

  const handleMonthDayClick = (day: Date) => {
    updateCurrentDate(day);
    setViewMode('day');
  };

  const handleWeekDayClick = (day: Date) => {
    updateCurrentDate(day);
    setViewMode('day');
  };

  // 判断是否为今天
  const isToday = isSameDay(currentDate, new Date());
  
  // 根据视图模式计算待办数量
  const getTodoCount = () => {
    const incomplete = (s: Schedule) => !s.is_completed;
    
    if (viewMode === 'day') {
      // 日视图：只有当天是今天时才显示
      if (!isToday) return null;
      const count = visibleSchedules.filter(s => incomplete(s) && isSameDay(new Date(s.start_time), new Date())).length;
      return count > 0 ? { label: '今日待办', count } : null;
    } else if (viewMode === 'week') {
      // 周视图：显示当周的待办数量
      const weekStart = startOfWeek(currentDate);
      const weekEnd = endOfWeek(currentDate);
      const count = visibleSchedules.filter(s => incomplete(s) && isWithinInterval(new Date(s.start_time), { start: weekStart, end: weekEnd })).length;
      return count > 0 ? { label: '本周待办', count } : null;
    } else {
      // 月视图：显示当月的待办数量
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const count = visibleSchedules.filter(s => incomplete(s) && isWithinInterval(new Date(s.start_time), { start: monthStart, end: monthEnd })).length;
      return count > 0 ? { label: '本月待办', count } : null;
    }
  };
  
  const todoInfo = getTodoCount();

  return (
    <div
      className="calendar-v2-root flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: 'var(--td-bg-color-container)' }}
      onContextMenuCapture={event => {
        const card = (event.target as HTMLElement).closest<HTMLElement>('[data-schedule-id]');
        const schedule = card ? schedules.find(item => item.id === card.dataset.scheduleId) : null;
        if (!schedule) return;
        event.preventDefault();
        setContextMenu({ schedule, x: event.clientX, y: event.clientY });
      }}
      onKeyDownCapture={event => {
        if (!((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) return;
        const card = (event.target as HTMLElement).closest<HTMLElement>('[data-schedule-id]');
        const schedule = card ? schedules.find(item => item.id === card.dataset.scheduleId) : null;
        if (!schedule || !card) return;
        event.preventDefault();
        const rect = card.getBoundingClientRect();
        setContextMenu({ schedule, x: rect.left + 28, y: rect.top + 28 });
      }}
    >
      {/* 顶部工具栏 */}
      <div
        className="calendar-toolbar flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--td-component-stroke)' }}
      >
        <div className="calendar-toolbar-primary flex items-center gap-2">
          {onOpenRail && (
            <button
              type="button"
              onClick={onOpenRail}
              className="calendar-rail-trigger p-1.5 rounded-lg transition-colors"
              aria-label="打开日历侧栏"
              aria-controls="schedule-navigation-rail"
              aria-expanded={isRailOpen}
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={goToday}
            className="calendar-go-today px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ backgroundColor: 'var(--td-brand-color-light)', color: 'var(--td-brand-color)' }}
            aria-label="回到今天"
          >
            <span className="calendar-go-today-full">回到今天</span>
            <span className="calendar-go-today-compact" aria-hidden="true">今天</span>
          </button>
          <button 
            onClick={navigatePrev} 
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--td-text-color-secondary)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button 
            onClick={navigateNext} 
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--td-text-color-secondary)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="calendar-toolbar-date calendar-toolbar-date-full" style={{ color: 'var(--td-text-color-primary)' }}>
            {headerTitle()}
          </span>
          <span className="calendar-toolbar-date calendar-toolbar-date-compact" style={{ color: 'var(--td-text-color-primary)' }}>
            {compactHeaderTitle()}
          </span>
          {(viewMode === 'agenda' || viewMode === 'day') && isToday && <span className="calendar-today-badge">今天</span>}
          {(showLunar || showFestivals) && (() => {
            const meta = getCalendarDayMeta(currentDate);
            const label = [showLunar ? meta.lunarFullLabel : '', showFestivals ? (meta.festivals[0] || meta.solarTerm) : ''].filter(Boolean).join(' · ');
            return label ? <span className="calendar-toolbar-meta">{label}</span> : null;
          })()}
          {todoInfo && (
            <span className="calendar-toolbar-todo text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#EF444420', color: '#EF4444' }}>
              {todoInfo.label} {todoInfo.count} 项
            </span>
          )}
        </div>

        <div className="calendar-toolbar-actions flex items-center gap-2">
          <div className="calendar-view-switch flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--td-component-stroke)' }}>
            {([
              { key: 'agenda', label: '日程', Icon: LayoutList },
              { key: 'day', label: '日', Icon: Calendar },
              { key: 'week', label: '周', Icon: LayoutGrid },
              { key: 'month', label: '月', Icon: CalendarDays },
            ] as { key: ViewMode; label: string; Icon: any }[]).map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                className="px-3 py-1.5 flex items-center gap-1 text-xs font-medium transition-all"
                aria-label={`切换到${label}视图`}
                style={{
                  backgroundColor: viewMode === key ? 'var(--td-brand-color)' : 'transparent',
                  color: viewMode === key ? '#fff' : 'var(--td-text-color-secondary)',
                }}
              >
                <Icon className="w-3 h-3" />
                <span className="calendar-view-label">{label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="calendar-add-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
            aria-label="添加日程"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加日程</span>
          </button>
        </div>
      </div>

      {/* 冲突检测警告 + 通知权限提示 */}
      {(() => {
        // 检测当前视图日期的冲突（包括已完成日程）
        const viewDateSchedules = visibleSchedules.filter(
          s => !s.all_day && s.type === 'event' && isSameDay(new Date(s.start_time), currentDate)
        );
        
        const conflictingIds = getConflictingScheduleIds(viewDateSchedules);
        const conflictMap = groupConflictingSchedulesByTimeSlot(viewDateSchedules);
        
        // 收集冲突详情用于Banner显示
        const conflictDetails: { a: Schedule; b: Schedule }[] = [];
        const processed = new Set<string>();
        viewDateSchedules.forEach(s => {
          if (conflictingIds.has(s.id)) {
            viewDateSchedules.forEach(other => {
              if (other.id !== s.id && !processed.has(other.id) && checkScheduleConflict(s, other)) {
                conflictDetails.push({ a: s, b: other });
                processed.add(s.id);
                processed.add(other.id);
              }
            });
          }
        });

        const showNotifBanner = notifPermission === 'default' && visibleSchedules.some(s => s.reminders?.length > 0);
        
        const hasConflicts = conflictingIds.size > 0;

        return (
          <>
            {/* 冲突Banner提醒 */}
            {hasConflicts && (
              <div
                className="flex items-center gap-2 px-4 py-2 flex-shrink-0 text-xs"
                style={{ backgroundColor: '#FEF2F2', borderBottom: '1px solid #FECACA', color: '#DC2626' }}
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="font-semibold">
                  {conflictingIds.size} 个日程存在时间冲突
                </span>
                <span style={{ color: '#991B1B' }}>
                  {conflictDetails.slice(0, 3).map(({ a, b }, i) => (
                    <span key={i}>
                      「{a.title}」与「{b.title}」
                      {i < Math.min(conflictDetails.length, 3) - 1 && '、'}
                    </span>
                  ))}
                  {conflictDetails.length > 3 && ` 等${conflictDetails.length}组`}
                </span>
              </div>
            )}
            {showNotifBanner && (
              <div
                className="flex items-center justify-between gap-2 px-4 py-2 flex-shrink-0 text-xs"
                style={{ backgroundColor: 'var(--td-brand-color-light)', borderBottom: '1px solid var(--td-component-stroke)', color: 'var(--td-brand-color)' }}
              >
                <div className="flex items-center gap-2">
                  <Bell className="w-3.5 h-3.5" />
                  <span>你有日程设置了提醒，请开启浏览器通知权限</span>
                </div>
                <button
                  onClick={requestNotifPermission}
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
                >
                  开启通知
                </button>
              </div>
            )}
          </>
        );
      })()}

      {/* 日程内容区 */}
      <div className={`calendar-content-viewport calendar-content-${viewMode} flex-1 overflow-hidden`}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>加载中...</div>
          </div>
        ) : (
          (() => {
            if (viewMode === 'agenda') {
              return (
                <AgendaView
                  schedules={visibleSchedules}
                  selectedDate={currentDate}
                  calendars={calendars}
                  showLunar={showLunar}
                  showFestivals={showFestivals}
                  onSelectDate={updateCurrentDate}
                  onOpenSchedule={setSelectedSchedule}
                  onToggleSchedule={handleToggle}
                  onOpenContextMenu={(schedule, x, y) => setContextMenu({ schedule, x, y })}
                />
              );
            }

            // 计算当前视图日期范围的冲突信息（统一计算，供所有视图使用）
            // 日视图：包括待办任务用于冲突排版（但不提示冲突）
            const getViewDateSchedules = () => {
              if (viewMode === 'day') {
                return visibleSchedules.filter(
                  s => !s.all_day && (s.type === 'event' || s.type === 'todo') && isSameDay(new Date(s.start_time), currentDate)
                );
              } else if (viewMode === 'week') {
                const weekStart = getWeekStart(currentDate);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 7);
                return visibleSchedules.filter(
                  s => !s.all_day && s.type === 'event' &&
                    new Date(s.start_time) >= weekStart && new Date(s.start_time) < weekEnd
                );
              } else {
                // 月视图：整月的日程
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth();
                return visibleSchedules.filter(
                  s => !s.all_day && s.type === 'event' &&
                    new Date(s.start_time).getFullYear() === year &&
                    new Date(s.start_time).getMonth() === month
                );
              }
            };
            
            const viewDateSchedules = getViewDateSchedules();
            // 日视图冲突检测包括待办任务（用于排版）
            const conflictingIds = getConflictingScheduleIds(viewDateSchedules, viewMode === 'day');
            const conflictMap = groupConflictingSchedulesByTimeSlot(viewDateSchedules, viewMode === 'day');
            
            if (viewMode === 'day') {
              return (
                <DayView
                  date={currentDate}
                  schedules={visibleSchedules}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={setEditingSchedule}
                  onClickSchedule={setSelectedSchedule}
                  conflictingIds={conflictingIds}
                  conflictMap={conflictMap}
                  activeCalendars={calendars}
                />
              );
            } else if (viewMode === 'week') {
              return (
                <WeekView
                  weekStart={getWeekStart(currentDate)}
                  schedules={visibleSchedules}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={setEditingSchedule}
                  onClickSchedule={setSelectedSchedule}
                  onClickDay={handleWeekDayClick}
                  conflictingIds={conflictingIds}
                  activeCalendars={calendars}
                  showLunar={showLunar}
                  showFestivals={showFestivals}
                />
              );
            } else {
              return (
                <MonthView
                  year={currentDate.getFullYear()}
                  month={currentDate.getMonth()}
                  schedules={visibleSchedules}
                  selectedDate={currentDate}
                  onSelectDate={handleMonthDayClick}
                  onToggle={handleToggle}
                  onClickSchedule={setSelectedSchedule}
                  conflictingIds={conflictingIds}
                  activeCalendars={calendars}
                  showLunar={showLunar}
                  showFestivals={showFestivals}
                />
              );
            }
          })()
        )}
      </div>

      {/* 新增日程弹窗 */}
      {showAddModal && (
        <ScheduleFormModal
          defaultDate={currentDate}
          onSave={handleAddSchedule}
          onClose={() => setShowAddModal(false)}
          activeCalendars={calendars.filter(c => activeCalendarIds?.includes(c.id))}
        />
      )}

      {/* 编辑日程弹窗 */}
      {editingSchedule && (
        <ScheduleFormModal
          defaultDate={currentDate}
          editingSchedule={editingSchedule}
          onSave={handleEditSchedule}
          onClose={() => setEditingSchedule(null)}
          activeCalendars={calendars.filter(c => activeCalendarIds?.includes(c.id))}
        />
      )}

      {/* 日程详情弹窗 */}
      {selectedSchedule && !editingSchedule && (
        <ScheduleDetailModal
          schedule={selectedSchedule}
          onClose={() => setSelectedSchedule(null)}
          onDelete={handleDelete}
          onToggle={handleToggle}
          onEdit={(s) => { setSelectedSchedule(null); setEditingSchedule(s); }}
          calendar={calendars.find(c => c.id === selectedSchedule.calendar_id)}
        />
      )}

      {contextMenu && (
        <ScheduleContextMenu
          schedule={contextMenu.schedule}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onEdit={schedule => { setSelectedSchedule(null); setEditingSchedule(schedule); }}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
