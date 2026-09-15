import {
endOfMonth,
endOfWeek,
isWithinInterval,
startOfMonth,
startOfWeek
} from 'date-fns';
import {
AlertTriangle,
Bell,
Calendar,CalendarDays,
CheckCircle2,
ChevronLeft,ChevronRight,
Circle,
Clock,
Edit3,
LayoutGrid,
LayoutList,
MapPin,
PanelLeftOpen,
Plus,
Trash2,
X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getScheduleCategory } from '../utils/scheduleCategories';
import {
buildConflictKey,
CONFLICT_DISMISS_TTL_MS,
getConflictExpiryAt,
getConflictingScheduleIds,
getConflictPairs,
groupConflictingSchedulesByTimeSlot,
isConflictDismissed,
isTimedConflictSchedule,
parseScheduleDate,
type ConflictDismissal,
} from '../utils/scheduleConflict';
import { AgendaView } from './calendar/AgendaView';
import { getCalendarDayMeta } from './calendar/calendarMeta';
import { CATEGORY_COLORS, CATEGORY_LABELS, formatTime, PRIORITY_COLORS, WEEKDAY_LABELS } from './calendar/schedule-presentation';
import type { Schedule } from './calendar/schedule-types';
import { ScheduleContextMenu } from './calendar/ScheduleContextMenu';
import { ScheduleDetailModal } from './calendar/ScheduleDetailModal';
import { ScheduleFormModal } from './calendar/ScheduleFormModal';

type ViewMode = 'agenda' | 'day' | 'week' | 'month';

// 暗色模式优先级颜色
const PRIORITY_COLORS_DARK: Record<string, { bg: string; border: string; dot: string }> = {
  high:   { bg: 'rgba(239,68,68,0.15)',   border: '#EF4444', dot: '#EF4444' },
  medium: { bg: 'rgba(245,158,11,0.12)',  border: '#F59E0B', dot: '#F59E0B' },
  low:    { bg: 'rgba(16,185,129,0.12)',  border: '#10B981', dot: '#10B981' },
};

const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const CONFLICT_DISMISS_STORAGE_KEY = 'calendar-conflict-dismissal-v1';

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
  return parseScheduleDate(dateStr);
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

// ==================== 小日程卡片（带优先级颜色） ====================

function ScheduleChip({
  schedule,
  compact = false,
  onToggle,
  onDelete,
  onEdit,
  onClick,
}: {
  schedule: Schedule;
  compact?: boolean;
  onToggle?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (s: Schedule) => void;
  onClick?: (s: Schedule) => void;
}) {
  const pColor = PRIORITY_COLORS[schedule.priority] || PRIORITY_COLORS.medium;
  const category = getScheduleCategory(schedule.category);
  const catColor = category.color;

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
        <span className="rounded px-0.5 flex-shrink-0" style={{ border: `1px solid ${category.color}`, fontSize: '8px' }} title={category.name}>
          <span className="calendar-color-dot" style={{ backgroundColor: category.color }} />
        </span>
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
  date, schedules, onToggle, onDelete, onEdit, onClickSchedule, conflictingIds, conflictMap,
}: {
  date: Date;
  schedules: Schedule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (s: Schedule) => void;
  onClickSchedule: (s: Schedule) => void;
  conflictingIds?: Set<string>;
  conflictMap?: Map<string, Schedule[]>;
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
            // 待办任务显示在对应小时（固定视觉高度，与持续时长无关）
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
                      const isConflicting = conflictingIds?.has(s.id) === true;
                      
                      return (
                        <div
                          key={s.id}
                          data-schedule-id={s.id}
                          tabIndex={0}
                          className="rounded-lg px-1.5 py-1 cursor-pointer overflow-hidden group flex-shrink-0"
                          style={{
                            height: '44px',
                            backgroundColor: s.is_completed ? 'var(--td-bg-color-component)' : `${pColor.dot}15`,
                            border: isConflicting ? '1px solid #EF4444' : s.is_completed ? `1px solid var(--td-component-stroke)` : `1px dashed ${pColor.dot}50`,
                            borderLeft: isConflicting ? '3px solid #EF4444' : s.is_completed ? `3px solid #9CA3AF` : `3px dashed ${pColor.dot}`,
                            opacity: s.is_completed ? 0.65 : 1,
                          }}
                          onClick={() => onClickSchedule(s)}
                        >
                          <div className="flex items-center gap-0.5">
                            <span className="schedule-status-slot compact">
                              <button
                                onClick={e => { e.stopPropagation(); onToggle(s.id); }}
                                className="opacity-60 hover:opacity-100 flex-shrink-0"
                              >
                                {s.is_completed ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Circle className="w-3 h-3" style={{ color: pColor.dot }} />}
                              </button>
                              {isConflicting && <span title="时间冲突" aria-label="时间冲突" className="schedule-conflict-dot">!</span>}
                            </span>
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
  weekStart, schedules, onToggle, onDelete, onEdit, onClickSchedule, onClickDay, conflictingIds, showLunar, showFestivals,
}: {
  weekStart: Date;
  schedules: Schedule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (s: Schedule) => void;
  onClickSchedule: (s: Schedule) => void;
  onClickDay: (d: Date) => void;
  conflictingIds?: Set<string>;
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
                  <span className="schedule-status-slot compact">
                    <button
                      onClick={e => { e.stopPropagation(); onToggle(s.id); }}
                      className="flex-shrink-0"
                    >
                      {s.is_completed ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                    </button>
                    {conflictingIds?.has(s.id) && <span title="时间冲突" aria-label="时间冲突" className="schedule-conflict-dot">!</span>}
                  </span>
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
                          className="relative rounded px-1 py-0.5 cursor-pointer text-xs truncate mb-0.5 flex items-center gap-1"
                          style={{
                            backgroundColor: `${pColor.dot}22`,
                            borderLeft: `2.5px solid ${pColor.dot}`,
                            color: pColor.dot,
                            opacity: s.is_completed ? 0.5 : 1,
                          }}
                          onClick={() => onClickSchedule(s)}
                        >
                          {isConflicting && <span className="schedule-conflict-overlay" title="时间冲突" aria-label="时间冲突">!</span>}
                          <span className="opacity-70">{formatTime(s.start_time)}</span><span className="schedule-title-primary schedule-title-compact truncate">{s.title}</span>
                          <span
                            className="rounded px-0.5 flex-shrink-0"
                            style={{ border: `1px solid ${getScheduleCategory(s.category).color}`, fontSize: '7px' }}
                            title={getScheduleCategory(s.category).name}
                          >
                            <span className="calendar-color-dot" style={{ backgroundColor: getScheduleCategory(s.category).color }} />
                          </span>
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
  year, month, schedules, selectedDate, onSelectDate, onToggle, onClickSchedule, conflictingIds, showLunar, showFestivals,
}: {
  year: number;
  month: number;
  schedules: Schedule[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onToggle?: (id: string) => void;
  onClickSchedule?: (s: Schedule) => void;
  conflictingIds?: Set<string>;
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
                  {timedTodos.slice(0, 1).map(s => {
                    const isConflicting = conflictingIds?.has(s.id) === true;
                    return (
                      <div
                        key={s.id}
                        data-schedule-id={s.id}
                        tabIndex={0}
                        className="rounded px-1 py-0.5 text-xs truncate cursor-pointer flex items-center gap-0.5"
                        style={{
                          backgroundColor: `${PRIORITY_COLORS[s.priority]?.dot || '#F59E0B'}15`,
                          color: PRIORITY_COLORS[s.priority]?.dot || '#F59E0B',
                          border: isConflicting ? '1px solid #EF4444' : '1px solid transparent',
                        }}
                        onClick={event => { event.stopPropagation(); onClickSchedule?.(s); }}
                      >
                        <span className="schedule-status-slot compact">
                          <button
                            onClick={e => { e.stopPropagation(); onToggle?.(s.id); }}
                            className="flex-shrink-0"
                          >
                            {s.is_completed ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Circle className="w-2.5 h-2.5" />}
                          </button>
                          {isConflicting && <span title="时间冲突" aria-label="时间冲突" className="schedule-conflict-dot">!</span>}
                        </span>
                        <span className="opacity-70 text-[10px]">{formatTime(s.start_time)}</span>
                        <span className="schedule-title-primary schedule-title-compact truncate">{s.title}</span>
                      </div>
                    );
                  })}
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
                    <div key={s.id} className="calendar-chip-conflict-slot flex items-center gap-0.5">
                      {isConflicting && <span className="schedule-conflict-overlay" title="时间冲突" aria-label="时间冲突">!</span>}
                      <ScheduleChip schedule={s} compact onClick={onClickSchedule} />
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

// ==================== 主组件 ====================

export interface CalendarViewProps {
  refreshKey?: number;
  activeCategoryIds?: string[];
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
  activeCategoryIds,
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
  const [loading, setLoading] = useState(false);
  const { authHeaders } = useAuth();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [notifPermission, setNotifPermission] = useState<string>('default');
  const [contextMenu, setContextMenu] = useState<{ schedule: Schedule; x: number; y: number } | null>(null);
  const [conflictClock, setConflictClock] = useState(() => Date.now());
  const [dismissedConflict, setDismissedConflict] = useState<ConflictDismissal | null>(null);

  const updateCurrentDate = useCallback((date: Date) => {
    const next = new Date(date);
    setCurrentDate(next);
    onSelectedDateChange?.(next);
  }, [onSelectedDateChange]);

  useEffect(() => {
    if (!selectedDate || isSameDay(selectedDate, currentDate)) return;
    setCurrentDate(new Date(selectedDate));
  }, [selectedDate?.getTime()]);

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

  // 根据左侧六类日程分类过滤
  const visibleSchedules = useMemo(() => ((activeCategoryIds && activeCategoryIds.length > 0)
    ? schedules.filter(s => activeCategoryIds.includes(s.category))
    : schedules).filter(schedule => !schedule.is_unscheduled), [activeCategoryIds, schedules]);

  // 冲突提醒覆盖当前仍有重叠的日程/待办；已经结束的历史冲突由 getConflictPairs 自动排除。
  // 这样跨午夜仍在持续的日程也能参与“今天”的冲突判断。
  const { bannerConflictSchedules, bannerConflictPairs, bannerConflictingIds, bannerConflictKey, bannerConflictExpiryAt } = useMemo(() => {
    const conflictSchedules = visibleSchedules.filter(isTimedConflictSchedule);
    const conflictPairs = getConflictPairs(conflictSchedules, conflictClock);
    const conflictingIds = new Set<string>();
    conflictPairs.forEach(({ a, b }) => {
      conflictingIds.add(a.id);
      conflictingIds.add(b.id);
    });
    return {
      bannerConflictSchedules: conflictSchedules,
      bannerConflictPairs: conflictPairs,
      bannerConflictingIds: conflictingIds,
      bannerConflictKey: buildConflictKey(conflictSchedules, conflictingIds),
      bannerConflictExpiryAt: getConflictExpiryAt(conflictPairs),
    };
  }, [conflictClock, visibleSchedules]);

  useEffect(() => {
    if (!bannerConflictExpiryAt) return;
    const remaining = bannerConflictExpiryAt - Date.now();
    const delay = Math.min(Math.max(50, remaining + 50), 24 * 60 * 60 * 1000);
    const timer = window.setTimeout(() => setConflictClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [bannerConflictExpiryAt, bannerConflictKey]);

  useEffect(() => {
    if (!bannerConflictKey) {
      setDismissedConflict(null);
      return;
    }
    try {
      const stored = window.localStorage.getItem(CONFLICT_DISMISS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) as ConflictDismissal : null;
      if (parsed && isConflictDismissed(parsed, bannerConflictKey)) {
        setDismissedConflict(parsed);
      } else {
        setDismissedConflict(null);
        if (parsed) window.localStorage.removeItem(CONFLICT_DISMISS_STORAGE_KEY);
      }
    } catch {
      setDismissedConflict(null);
    }
  }, [bannerConflictKey]);

  useEffect(() => {
    if (!bannerConflictKey || !dismissedConflict || dismissedConflict.key !== bannerConflictKey) return;
    const remaining = CONFLICT_DISMISS_TTL_MS - (Date.now() - dismissedConflict.dismissedAt);
    if (remaining <= 0) {
      setDismissedConflict(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setDismissedConflict(null);
      try { window.localStorage.removeItem(CONFLICT_DISMISS_STORAGE_KEY); } catch {}
    }, remaining + 50);
    return () => window.clearTimeout(timer);
  }, [bannerConflictKey, dismissedConflict]);

  const showConflictBanner = bannerConflictPairs.length > 0 && !isConflictDismissed(dismissedConflict, bannerConflictKey);

  const dismissConflict = () => {
    if (!bannerConflictKey) return;
    const dismissal: ConflictDismissal = { key: bannerConflictKey, dismissedAt: Date.now() };
    setDismissedConflict(dismissal);
    try { window.localStorage.setItem(CONFLICT_DISMISS_STORAGE_KEY, JSON.stringify(dismissal)); } catch {}
  };

  const navigatePrev = () => {
    const d = new Date(currentDate);
    if (viewMode === 'agenda' || viewMode === 'day') d.setDate(d.getDate() - 1);
    else if (viewMode === 'week') d.setDate(d.getDate() - 7);
    else { d.setMonth(d.getMonth() - 1); d.setDate(1); }
    updateCurrentDate(d);
    setContextMenu(null);
  };

  const navigateNext = () => {
    const d = new Date(currentDate);
    if (viewMode === 'agenda' || viewMode === 'day') d.setDate(d.getDate() + 1);
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
          calendar_id: 'personal',
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
        const showNotifBanner = notifPermission === 'default' && visibleSchedules.some(s => s.reminders?.length > 0);

        return (
          <>
            {/* 冲突Banner提醒 */}
            {showConflictBanner && (
              <div
                className="calendar-conflict-banner flex items-center gap-2 px-4 py-2 flex-shrink-0 text-xs"
                style={{ backgroundColor: '#FEF2F2', borderBottom: '1px solid #FECACA', color: '#DC2626' }}
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="font-semibold">
                  {bannerConflictingIds.size} 个事项存在时间冲突
                </span>
                <span style={{ color: '#991B1B' }}>
                  {bannerConflictPairs.slice(0, 3).map(({ a, b }, i) => (
                    <span key={i}>
                      「{a.title}」与「{b.title}」
                      {i < Math.min(bannerConflictPairs.length, 3) - 1 && '、'}
                    </span>
                  ))}
                  {bannerConflictPairs.length > 3 && ` 等${bannerConflictPairs.length}组`}
                </span>
                <button
                  type="button"
                  className="calendar-conflict-dismiss"
                  onClick={dismissConflict}
                  aria-label="关闭冲突提醒"
                  title="关闭提醒，4小时后可再次出现"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
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
                  showLunar={showLunar}
                  showFestivals={showFestivals}
                  onSelectDate={updateCurrentDate}
                  onOpenSchedule={setSelectedSchedule}
                  onToggleSchedule={handleToggle}
                  onOpenContextMenu={(schedule, x, y) => setContextMenu({ schedule, x, y })}
                  conflictingIds={bannerConflictingIds}
                />
              );
            }

            // 计算当前视图日期范围的冲突信息（事件和待办统一处理）
            const getViewDateSchedules = () => {
              if (viewMode === 'day') {
                return visibleSchedules.filter(
                  s => isTimedConflictSchedule(s) && isSameDay(parseLocalDate(s.start_time), currentDate)
                );
              } else if (viewMode === 'week') {
                const weekStart = getWeekStart(currentDate);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 7);
                return visibleSchedules.filter(
                  s => isTimedConflictSchedule(s) &&
                    parseLocalDate(s.start_time) >= weekStart && parseLocalDate(s.start_time) < weekEnd
                );
              } else {
                // 月视图：整月的日程
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth();
                return visibleSchedules.filter(
                  s => isTimedConflictSchedule(s) &&
                    parseLocalDate(s.start_time).getFullYear() === year &&
                    parseLocalDate(s.start_time).getMonth() === month
                );
              }
            };
            
            const viewDateSchedules = getViewDateSchedules();
            // 日视图冲突检测包括待办任务（用于排版）
            const conflictingIds = getConflictingScheduleIds(viewDateSchedules, conflictClock);
            const conflictMap = groupConflictingSchedulesByTimeSlot(viewDateSchedules, conflictClock);
            
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
          defaultCategory={activeCategoryIds?.length === 1 ? activeCategoryIds[0] : undefined}
        />
      )}

      {/* 编辑日程弹窗 */}
      {editingSchedule && (
        <ScheduleFormModal
          defaultDate={currentDate}
          editingSchedule={editingSchedule}
          onSave={handleEditSchedule}
          onClose={() => setEditingSchedule(null)}
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
