import { useEffect, useMemo, useRef } from 'react';
import { CalendarDays, CheckCircle2, Circle, Clock3, MapPin } from 'lucide-react';
import type { Schedule } from '../CalendarView';
import { addCalendarDays, getCalendarDayMeta, toLocalDateKey } from './calendarMeta';
import { getScheduleCategory } from '../../utils/scheduleCategories';

interface AgendaViewProps {
  schedules: Schedule[];
  selectedDate: Date;
  showLunar: boolean;
  showFestivals: boolean;
  onSelectDate: (date: Date) => void;
  onOpenSchedule: (schedule: Schedule) => void;
  onToggleSchedule: (id: string) => void;
  onOpenContextMenu: (schedule: Schedule, x: number, y: number) => void;
}

function startOfLocalDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function parseLocal(value: string): Date {
  const [datePart, timePart = '00:00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, second || 0);
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
}: AgendaViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
    const element = containerRef.current?.querySelector<HTMLElement>(`[data-agenda-date="${selectedKey}"]`);
    element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedKey]);

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
              <span className="agenda-date-number">{group.date.getDate()}</span>
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
                    <button
                      type="button"
                      className="agenda-complete-button"
                      onClick={event => { event.stopPropagation(); onToggleSchedule(schedule.id); }}
                      aria-label={schedule.is_completed ? '标记未完成' : '标记完成'}
                    >
                      {schedule.is_completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                    </button>
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
