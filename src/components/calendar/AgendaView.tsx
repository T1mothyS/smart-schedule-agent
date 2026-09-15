import { CalendarDays, CheckCircle2, Circle, Clock3, MapPin } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { getScheduleCategory } from '../../utils/scheduleCategories';
import { parseScheduleDate } from '../../utils/scheduleConflict';
import { addCalendarDays, getCalendarDayMeta, toLocalDateKey } from './calendarMeta';
import type { Schedule } from './schedule-types';

interface AgendaViewProps {
  schedules: Schedule[];
  selectedDate: Date;
  showLunar: boolean;
  showFestivals: boolean;
  onSelectDate: (date: Date) => void;
  onOpenSchedule: (schedule: Schedule) => void;
  onToggleSchedule: (id: string) => void;
  onOpenContextMenu: (schedule: Schedule, x: number, y: number) => void;
  conflictingIds?: Set<string>;
}

function startOfLocalDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function parseLocal(value: string): Date {
  return parseScheduleDate(value);
}

function formatTime(schedule: Schedule): string {
  if (schedule.all_day) return '全天';
  const start = parseLocal(schedule.start_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!schedule.end_time) return start;
  const end = parseLocal(schedule.end_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${start} – ${end}`;
}

export function AgendaView({
  schedules,
  selectedDate,
  showLunar,
  showFestivals,
  onSelectDate,
  onOpenSchedule,
  onToggleSchedule,
  onOpenContextMenu,
  conflictingIds,
}: AgendaViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionFromScrollRef = useRef<string | null>(null);
  const programmaticScrollRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const selectedKey = toLocalDateKey(selectedDate);
  const todayKey = toLocalDateKey(new Date());

  const groups = useMemo(() => {
    const today = startOfLocalDay(new Date());
    const selected = startOfLocalDay(selectedDate);
    const scheduleDates = schedules.map(item => startOfLocalDay(parseLocal(item.start_time)));
    const earliest = scheduleDates.reduce((min, date) => date < min ? date : min, addCalendarDays(today, -30));
    const latest = scheduleDates.reduce((max, date) => date > max ? date : max, addCalendarDays(today, 365));
    const start = earliest < addCalendarDays(today, -30) ? earliest : addCalendarDays(today, -30);
    const end = latest > addCalendarDays(today, 365) ? latest : addCalendarDays(today, 365);
    if (selected < start) start.setTime(selected.getTime());
    if (selected > end) end.setTime(selected.getTime());

    const byDate = new Map<string, Schedule[]>();
    schedules.forEach(schedule => {
      const key = toLocalDateKey(parseLocal(schedule.start_time));
      const list = byDate.get(key) || [];
      list.push(schedule);
      byDate.set(key, list);
    });

    const result: Array<{ date: Date; key: string; schedules: Schedule[]; meta: ReturnType<typeof getCalendarDayMeta> }> = [];
    for (let cursor = new Date(start); cursor <= end; cursor = addCalendarDays(cursor, 1)) {
      const key = toLocalDateKey(cursor);
      const meta = getCalendarDayMeta(cursor);
      const daySchedules = (byDate.get(key) || []).sort((a, b) => {
        if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
        return parseLocal(a.start_time).getTime() - parseLocal(b.start_time).getTime();
      });
      const hasSystemItem = showFestivals && (meta.festivals.length > 0 || meta.solarTerm);
      if (daySchedules.length > 0 || hasSystemItem || key === selectedKey || key === todayKey) {
        result.push({ date: new Date(cursor), key, schedules: daySchedules, meta });
      }
    }
    return result;
  }, [schedules, selectedKey, todayKey, showFestivals]);

  useEffect(() => {
    if (selectionFromScrollRef.current === selectedKey) {
      selectionFromScrollRef.current = null;
      return;
    }
    const element = containerRef.current?.querySelector<HTMLElement>(`[data-agenda-date="${selectedKey}"]`);
    if (!element) return;
    if (programmaticScrollTimerRef.current != null) window.clearTimeout(programmaticScrollTimerRef.current);
    programmaticScrollRef.current = true;
    element.scrollIntoView({ block: 'start', behavior: 'smooth' });
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimerRef.current = null;
    }, 700);
    return () => {
      if (programmaticScrollTimerRef.current != null) window.clearTimeout(programmaticScrollTimerRef.current);
    };
  }, [selectedKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const syncDateFromScroll = () => {
      if (programmaticScrollRef.current) return;
      const containerTop = container.getBoundingClientRect().top + 10;
      const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-agenda-date]'));
      let active = rows[0];
      for (const row of rows) {
        if (row.getBoundingClientRect().top <= containerTop) active = row;
        else break;
      }
      const key = active?.dataset.agendaDate;
      if (!key || key === selectedKey) return;
      const group = groups.find(item => item.key === key);
      if (!group) return;
      selectionFromScrollRef.current = key;
      onSelectDate(group.date);
    };
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = window.setTimeout(() => {
        scrollIdleTimerRef.current = null;
        syncDateFromScroll();
      }, 140);
    };
    const cancelProgrammaticScroll = () => {
      programmaticScrollRef.current = false;
      if (programmaticScrollTimerRef.current != null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('wheel', cancelProgrammaticScroll, { passive: true });
    container.addEventListener('touchstart', cancelProgrammaticScroll, { passive: true });
    container.addEventListener('pointerdown', cancelProgrammaticScroll, { passive: true });
    container.addEventListener('keydown', cancelProgrammaticScroll);
    return () => {
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('wheel', cancelProgrammaticScroll);
      container.removeEventListener('touchstart', cancelProgrammaticScroll);
      container.removeEventListener('pointerdown', cancelProgrammaticScroll);
      container.removeEventListener('keydown', cancelProgrammaticScroll);
      if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
      if (programmaticScrollTimerRef.current != null) window.clearTimeout(programmaticScrollTimerRef.current);
    };
  }, [groups, selectedKey, onSelectDate]);

  return (
    <div ref={containerRef} className="agenda-view" aria-label="日程列表">
      {groups.map((group, index) => {
        const isToday = group.key === todayKey;
        const isSelected = group.key === selectedKey;
        const monthChanged = index === 0 || groups[index - 1].date.getMonth() !== group.date.getMonth();
        const systemItems = showFestivals ? [...group.meta.festivals, group.meta.solarTerm].filter(Boolean) : [];
        return (
          <section
            key={group.key}
            data-agenda-date={group.key}
            className={`agenda-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
          >
            {monthChanged && <div className="agenda-month-divider">{group.date.getFullYear()}年{group.date.getMonth() + 1}月</div>}
            <button type="button" className="agenda-date-column" onClick={() => onSelectDate(group.date)}>
              <span className="agenda-date-number"><b>{group.date.getDate()}</b><small>/{group.date.getMonth() + 1}</small></span>
              <span className="agenda-date-weekday">{group.date.toLocaleDateString('zh-CN', { weekday: 'short' })}</span>
              {showLunar && <span className="agenda-date-lunar">{group.meta.lunarFullLabel}</span>}
              {isToday && <strong>今天</strong>}
            </button>
            <div className="agenda-day-content">
              {systemItems.map(label => (
                <article key={label} className="agenda-system-item" aria-label={`${label}，系统日历，只读`}>
                  <CalendarDays size={16} />
                  <span>全天</span>
                  <strong>{label}</strong>
                  <em>系统日历</em>
                </article>
              ))}
              {group.schedules.map(schedule => {
                const category = getScheduleCategory(schedule.category);
                const color = category.color;
                const isConflicting = conflictingIds?.has(schedule.id) === true;
                return (
                  <article
                    key={schedule.id}
                    className={`agenda-schedule-card${schedule.is_completed ? ' completed' : ''}`}
                    style={{ '--schedule-color': color } as React.CSSProperties}
                    tabIndex={0}
                    role="button"
                    data-schedule-id={schedule.id}
                    onClick={() => onOpenSchedule(schedule)}
                    onContextMenu={event => {
                      event.preventDefault();
                      onOpenContextMenu(schedule, event.clientX, event.clientY);
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenSchedule(schedule);
                      }
                      if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        onOpenContextMenu(schedule, rect.left + 28, rect.top + 28);
                      }
                    }}
                  >
                    <span className="schedule-status-slot agenda-status-slot">
                      <button
                        type="button"
                        className="agenda-complete-button"
                        onClick={event => { event.stopPropagation(); onToggleSchedule(schedule.id); }}
                        aria-label={schedule.is_completed ? '标记未完成' : '标记完成'}
                      >
                        {schedule.is_completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </button>
                      {isConflicting && <span title="时间冲突" aria-label="时间冲突" className="schedule-conflict-dot">!</span>}
                    </span>
                    <div className="agenda-schedule-time">
                      <Clock3 size={14} />
                      <span>{formatTime(schedule)}</span>
                    </div>
                    <div className="agenda-schedule-main">
                      <strong>{schedule.title}</strong>
                      {(schedule.notes || schedule.location) && (
                        <p>
                          {schedule.location && <span><MapPin size={13} />{schedule.location}</span>}
                          {schedule.notes && <span>{schedule.notes}</span>}
                        </p>
                      )}
                    </div>
                    <span className="agenda-calendar-source">
                      <i style={{ backgroundColor: color }} />
                      {category.name}
                    </span>
                  </article>
                );
              })}
              {systemItems.length === 0 && group.schedules.length === 0 && (
                <div className="agenda-empty-day">这一天暂时没有安排</div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
