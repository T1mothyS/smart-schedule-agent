import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getPrimaryCalendarLabel, toLocalDateKey } from './calendarMeta';

interface MiniMonthCalendarProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  showLunar?: boolean;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function MiniMonthCalendar({ selectedDate, onSelectDate, showLunar = true }: MiniMonthCalendarProps) {
  const [anchor, setAnchor] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));

  useEffect(() => {
    setAnchor(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [selectedDate.getFullYear(), selectedDate.getMonth()]);

  const dates = useMemo(() => monthGrid(anchor), [anchor]);
  const todayKey = toLocalDateKey(new Date());
  const selectedKey = toLocalDateKey(selectedDate);

  const changeMonth = (amount: number) => {
    setAnchor(current => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  return (
    <section className="mini-month" aria-label="迷你月历">
      <header className="mini-month-head">
        <strong>{anchor.getFullYear()}年{anchor.getMonth() + 1}月</strong>
        <div>
          <button type="button" onClick={() => changeMonth(-1)} aria-label="上个月"><ChevronLeft size={15} /></button>
          <button type="button" onClick={() => changeMonth(1)} aria-label="下个月"><ChevronRight size={15} /></button>
        </div>
      </header>
      <div className="mini-month-weekdays">
        {WEEKDAYS.map(day => <span key={day}>周{day}</span>)}
      </div>
      <div className="mini-month-grid">
        {dates.map(date => {
          const dateKey = toLocalDateKey(date);
          const isCurrentMonth = date.getMonth() === anchor.getMonth();
          const isToday = dateKey === todayKey;
          const isSelected = dateKey === selectedKey;
          return (
            <button
              type="button"
              key={dateKey}
              className={`${isCurrentMonth ? '' : 'outside'}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelectDate(date)}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${date.toLocaleDateString('zh-CN')} ${showLunar ? getPrimaryCalendarLabel(date) : ''}`}
            >
              <span>{date.getDate()}</span>
              {showLunar && <small>{getPrimaryCalendarLabel(date)}</small>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
