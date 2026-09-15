import { Check, MoonStar, PartyPopper, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarView } from '../components/CalendarView';
import { ScheduleSidebar } from '../components/ScheduleSidebar';
import { MiniMonthCalendar } from '../components/calendar/MiniMonthCalendar';
import { SCHEDULE_CATEGORIES } from '../utils/scheduleCategories';

export interface SchedulePageProps {
  theme?: string;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  onOpenReminders?: () => void;
  user?: { id: string; email: string; role: 'admin' | 'user' } | null;
  onLogout?: () => void;
}

export function SchedulePage({ user }: SchedulePageProps) {
  const location = useLocation();
  const getSearchDate = () => {
    const value = new URLSearchParams(location.search).get('date');
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  };
  const [activeCategoryIds, setActiveCategoryIds] = useState<string[]>(() => SCHEDULE_CATEGORIES.map(category => category.id));
  const [selectedDate, setSelectedDate] = useState(getSearchDate);
  const [isRailOpen, setIsRailOpen] = useState(false);
  const railCloseButtonRef = useRef<HTMLButtonElement>(null);
  const [showLunar, setShowLunar] = useState(() => localStorage.getItem(`calendar:show-lunar:${user?.id || 'default'}`) !== 'false');
  const [showFestivals, setShowFestivals] = useState(() => localStorage.getItem(`calendar:show-festivals:${user?.id || 'default'}`) !== 'false');
  const [openScheduleRequest, setOpenScheduleRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [openScheduleMenuRequest, setOpenScheduleMenuRequest] = useState<{ id: string; x: number; y: number; nonce: number } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const dateValue = params.get('date');
    if (dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      const nextDate = new Date(`${dateValue}T12:00:00`);
      if (!Number.isNaN(nextDate.getTime())) setSelectedDate(nextDate);
    }
    const scheduleId = params.get('schedule');
    if (scheduleId) setOpenScheduleRequest({ id: scheduleId, nonce: Date.now() });
  }, [location.search]);

  useEffect(() => {
    if (!isRailOpen) return;

    railCloseButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsRailOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isRailOpen]);

  const handleActiveChange = useCallback((ids: string[]) => {
    setActiveCategoryIds(ids);
  }, []);

  const updateSystemCalendar = (type: 'lunar' | 'festival') => {
    if (type === 'lunar') {
      setShowLunar(value => {
        localStorage.setItem(`calendar:show-lunar:${user?.id || 'default'}`, String(!value));
        return !value;
      });
    } else {
      setShowFestivals(value => {
        localStorage.setItem(`calendar:show-festivals:${user?.id || 'default'}`, String(!value));
        return !value;
      });
    }
  };

  return (
    <div className="schedule-workspace">
      <div className="schedule-workspace-body">
        <aside
          id="schedule-navigation-rail"
          className={isRailOpen ? 'schedule-left-rail is-open' : 'schedule-left-rail'}
          aria-label="日历导航"
        >
          <div className="schedule-rail-mobile-head">
            <strong>日历导航</strong>
            <button
              ref={railCloseButtonRef}
              type="button"
              onClick={() => setIsRailOpen(false)}
              aria-label="关闭日历侧栏"
            >
              <X size={18} />
            </button>
          </div>
          <div className="schedule-rail-sections">
            <div
              className="schedule-rail-module schedule-rail-month"
            >
              <MiniMonthCalendar
                selectedDate={selectedDate}
                onSelectDate={(date) => {
                  setSelectedDate(date);
                  setIsRailOpen(false);
                }}
                showLunar={showLunar}
              />
            </div>
            <div
              className="schedule-rail-module schedule-rail-categories"
            >
              <ScheduleSidebar
                activeCategoryIds={activeCategoryIds}
                onActiveChange={handleActiveChange}
              />
            </div>
            <div
              className="schedule-rail-module schedule-rail-system"
            >
              <div className="system-calendar-list">
                <div className="system-calendar-heading">
                  <strong>其他日历</strong>
                </div>
                <div className="system-calendar-items">
                  <button type="button" onClick={() => updateSystemCalendar('lunar')} className={showLunar ? 'active' : ''}>
                    <span className="system-calendar-check">{showLunar && <Check size={11} />}</span>
                    <MoonStar size={15} />
                    <span>农历与节气</span>
                  </button>
                  <button type="button" onClick={() => updateSystemCalendar('festival')} className={showFestivals ? 'active' : ''}>
                    <span className="system-calendar-check">{showFestivals && <Check size={11} />}</span>
                    <PartyPopper size={15} />
                    <span>节日</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
        {isRailOpen && (
          <button
            type="button"
            className="schedule-rail-scrim"
            onClick={() => setIsRailOpen(false)}
            aria-label="关闭侧栏并返回日程"
          />
        )}
        <section className="schedule-calendar-shell">
          <main className="schedule-calendar-main">
            <CalendarView
              activeCategoryIds={activeCategoryIds}
              openScheduleRequest={openScheduleRequest}
              openScheduleMenuRequest={openScheduleMenuRequest}
              selectedDate={selectedDate}
              onSelectedDateChange={setSelectedDate}
              showLunar={showLunar}
              showFestivals={showFestivals}
              onOpenRail={() => setIsRailOpen(true)}
              isRailOpen={isRailOpen}
            />
          </main>
        </section>
      </div>
    </div>
  );
}
