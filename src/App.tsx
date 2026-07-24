import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useAuth } from './hooks/useAuth';
import { CalendarDays, Check, Eye, EyeOff, MoonStar, PartyPopper, X } from 'lucide-react';

import { SettingsPage } from './components/SettingsPage';
import { AdminModal } from './components/AdminModal';
import { AiSchedulePanel } from './components/AiSchedulePanel';
import { CalendarView } from './components/CalendarView';
import { ScheduleSidebar } from './components/ScheduleSidebar';
import { LoginPage } from './pages/LoginPage';
import { ReminderPage } from './components/ReminderPage';
import { AppShell } from './components/AppShell';
import { ActionCenterPage } from './components/ActionCenterPage';
import { AiImportPage } from './components/AiImportPage';
import { MiniMonthCalendar } from './components/calendar/MiniMonthCalendar';

// ==================== 日程主页（三栏布局） ====================

interface SchedulePageProps {
  theme?: string;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  onOpenReminders?: () => void;
  models?: any[];
  onRefreshModels?: () => void;
  user?: { id: string; email: string; role: 'admin' | 'user' } | null;
  onLogout?: () => void;
}

type RailModuleKey = 'month' | 'calendars' | 'system' | 'assistant';

const RAIL_MODULE_MIN_HEIGHT: Record<RailModuleKey, number> = {
  month: 180,
  calendars: 86,
  system: 82,
  assistant: 150,
};

const DEFAULT_COLLAPSED_MODULES: Record<RailModuleKey, boolean> = {
  month: false,
  calendars: false,
  system: false,
  assistant: false,
};

function SchedulePage({ user }: SchedulePageProps) {
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [activeCalendarIds, setActiveCalendarIds] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isRailOpen, setIsRailOpen] = useState(false);
  const [collapsedRailModules, setCollapsedRailModules] = useState(DEFAULT_COLLAPSED_MODULES);
  const [railModuleSizes, setRailModuleSizes] = useState<Partial<Record<RailModuleKey, number>>>({});
  const railCloseButtonRef = useRef<HTMLButtonElement>(null);
  const railModuleRefs = useRef<Record<RailModuleKey, HTMLDivElement | null>>({
    month: null,
    calendars: null,
    system: null,
    assistant: null,
  });
  const [showLunar, setShowLunar] = useState(() => localStorage.getItem(`calendar:show-lunar:${user?.id || 'default'}`) !== 'false');
  const [showFestivals, setShowFestivals] = useState(() => localStorage.getItem(`calendar:show-festivals:${user?.id || 'default'}`) !== 'false');
  const [openScheduleRequest, setOpenScheduleRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [openScheduleMenuRequest, setOpenScheduleMenuRequest] = useState<{ id: string; x: number; y: number; nonce: number } | null>(null);

  useEffect(() => {
    if (!isRailOpen) return;

    railCloseButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsRailOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isRailOpen]);

  useEffect(() => {
    const resetTemporaryRailSizes = () => setRailModuleSizes({});
    window.addEventListener('resize', resetTemporaryRailSizes);
    return () => window.removeEventListener('resize', resetTemporaryRailSizes);
  }, []);

  const handleSchedulesCreated = useCallback(() => {
    setCalendarRefreshKey(prev => prev + 1);
  }, []);

  const handleActiveChange = useCallback((ids: string[]) => {
    setActiveCalendarIds(ids);
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

  const toggleRailModule = (key: RailModuleKey) => {
    setCollapsedRailModules(current => ({ ...current, [key]: !current[key] }));
  };

  const resizeRailPair = useCallback((upper: RailModuleKey, lower: RailModuleKey, delta: number) => {
    if (collapsedRailModules[upper] || collapsedRailModules[lower]) return;
    const upperElement = railModuleRefs.current[upper];
    const lowerElement = railModuleRefs.current[lower];
    if (!upperElement || !lowerElement) return;

    const upperHeight = upperElement.getBoundingClientRect().height;
    const lowerHeight = lowerElement.getBoundingClientRect().height;
    const boundedDelta = Math.max(
      RAIL_MODULE_MIN_HEIGHT[upper] - upperHeight,
      Math.min(delta, lowerHeight - RAIL_MODULE_MIN_HEIGHT[lower]),
    );
    if (Math.abs(boundedDelta) < 0.5) return;

    setRailModuleSizes(current => ({
      ...current,
      [upper]: upperHeight + boundedDelta,
      [lower]: lowerHeight - boundedDelta,
    }));
  }, [collapsedRailModules]);

  const beginRailResize = (
    upper: RailModuleKey,
    lower: RailModuleKey,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (collapsedRailModules[upper] || collapsedRailModules[lower]) return;
    const upperElement = railModuleRefs.current[upper];
    const lowerElement = railModuleRefs.current[lower];
    if (!upperElement || !lowerElement) return;

    event.preventDefault();
    const startY = event.clientY;
    const upperHeight = upperElement.getBoundingClientRect().height;
    const lowerHeight = lowerElement.getBoundingClientRect().height;
    document.body.classList.add('is-resizing-schedule-rail');

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rawDelta = moveEvent.clientY - startY;
      const boundedDelta = Math.max(
        RAIL_MODULE_MIN_HEIGHT[upper] - upperHeight,
        Math.min(rawDelta, lowerHeight - RAIL_MODULE_MIN_HEIGHT[lower]),
      );
      setRailModuleSizes(current => ({
        ...current,
        [upper]: upperHeight + boundedDelta,
        [lower]: lowerHeight - boundedDelta,
      }));
    };

    const finishResize = () => {
      document.body.classList.remove('is-resizing-schedule-rail');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
  };

  const railModuleStyle = (key: RailModuleKey) => (
    railModuleSizes[key] ? { flex: `0 0 ${railModuleSizes[key]}px` } : undefined
  );

  const railResizeHandle = (upper: RailModuleKey, lower: RailModuleKey, label: string) => {
    const disabled = collapsedRailModules[upper] || collapsedRailModules[lower];
    return (
      <div
        className={`schedule-rail-resizer${disabled ? ' is-disabled' : ''}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={event => beginRailResize(upper, lower, event)}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          resizeRailPair(upper, lower, event.key === 'ArrowUp' ? -12 : 12);
        }}
      >
        <span />
      </div>
    );
  };

  return (
    <div className="schedule-workspace">
      <div className="schedule-workspace-body">
        <aside
          id="schedule-navigation-rail"
          className={isRailOpen ? 'schedule-left-rail is-open' : 'schedule-left-rail'}
          aria-label="日历导航与日程助手"
        >
          <div className="schedule-rail-mobile-head">
            <strong>日历与助手</strong>
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
              ref={element => { railModuleRefs.current.month = element; }}
              className={`schedule-rail-module schedule-rail-month${collapsedRailModules.month ? ' is-collapsed' : ''}`}
              style={railModuleStyle('month')}
            >
              <MiniMonthCalendar
                selectedDate={selectedDate}
                onSelectDate={(date) => {
                  setSelectedDate(date);
                  setIsRailOpen(false);
                }}
                showLunar={showLunar}
                collapsed={collapsedRailModules.month}
                onToggleCollapsed={() => toggleRailModule('month')}
              />
            </div>
            {railResizeHandle('month', 'calendars', '调整迷你月历和我的日历高度')}
            <div
              ref={element => { railModuleRefs.current.calendars = element; }}
              className={`schedule-rail-module schedule-rail-calendars${collapsedRailModules.calendars ? ' is-collapsed' : ''}`}
              style={railModuleStyle('calendars')}
            >
              <ScheduleSidebar
                activeCalendarIds={activeCalendarIds}
                onActiveChange={handleActiveChange}
                collapsed={collapsedRailModules.calendars}
                onToggleCollapsed={() => toggleRailModule('calendars')}
              />
            </div>
            {railResizeHandle('calendars', 'system', '调整我的日历和其他日历高度')}
            <div
              ref={element => { railModuleRefs.current.system = element; }}
              className={`schedule-rail-module schedule-rail-system${collapsedRailModules.system ? ' is-collapsed' : ''}`}
              style={railModuleStyle('system')}
            >
              <div className="system-calendar-list">
                <div className="system-calendar-heading">
                  <strong>其他日历</strong>
                  <button
                    type="button"
                    onClick={() => toggleRailModule('system')}
                    aria-label={collapsedRailModules.system ? '展开其他日历' : '隐藏其他日历'}
                    title={collapsedRailModules.system ? '展开其他日历' : '隐藏其他日历'}
                  >
                    {collapsedRailModules.system ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </div>
                {!collapsedRailModules.system && (
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
                )}
              </div>
            </div>
            {railResizeHandle('system', 'assistant', '调整其他日历和 AI 日程助手高度')}
            <div
              ref={element => { railModuleRefs.current.assistant = element; }}
              className={`schedule-rail-module schedule-rail-assistant${collapsedRailModules.assistant ? ' is-collapsed' : ''}`}
              style={railModuleStyle('assistant')}
            >
              <AiSchedulePanel
                onSchedulesCreated={handleSchedulesCreated}
                onOpenSchedule={(id) => setOpenScheduleRequest({ id, nonce: Date.now() })}
                onOpenScheduleMenu={(id, x, y) => setOpenScheduleMenuRequest({ id, x, y, nonce: Date.now() })}
                activeCalendarIds={activeCalendarIds}
                collapsed={collapsedRailModules.assistant}
                onToggleCollapsed={() => toggleRailModule('assistant')}
              />
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
              refreshKey={calendarRefreshKey}
              activeCalendarIds={activeCalendarIds}
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

// ==================== App 路由 ====================

function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // 动态更新 Tab 标题
  useEffect(() => {
    if (isLoading) {
      document.title = 'AI Calendar - Loading...';
      return;
    }

    if (!isAuthenticated) {
      document.title = 'AI Calendar - 登录 / Login';
    } else {
      // 检查是否打开了设置弹窗
      const settingsDialog = document.querySelector('.settings-dialog-content');
      if (settingsDialog) {
        document.title = 'AI Calendar - 设置 / Settings';
      } else {
        document.title = 'AI Calendar - 首页 / Home';
      }
    }
  }, [isAuthenticated, isLoading, location.pathname]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
        <div className="text-center">
          <CalendarDays size={38} className="mx-auto mb-3" aria-hidden="true" />
          <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {!isAuthenticated ? (
        <>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<LoginPage />} />
        </>
      ) : (
        <>
          <Route path="/today" element={<AppContent />} />
          <Route path="/schedule" element={<AppContent />} />
          <Route path="/reminders" element={<AppContent />} />
          <Route path="/import" element={<AppContent />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </>
      )}
    </Routes>
  );
}

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { models, fetchModels } = useModels();
  const { user, logout } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection = location.pathname === '/schedule' ? 'schedule' : location.pathname === '/reminders' ? 'reminders' : location.pathname === '/import' ? 'import' : 'today';
  const changeSection = (section: 'today' | 'schedule' | 'reminders' | 'import') => navigate(section === 'schedule' ? '/schedule' : section === 'reminders' ? '/reminders' : section === 'import' ? '/import' : '/today');

  // 设置弹窗打开/关闭时更新 Tab 标题
  useEffect(() => {
    document.title = showSettings
      ? 'AI Calendar - 设置 / Settings'
      : showAdmin
      ? 'AI Calendar - 管理面板 / Admin'
      : 'AI Calendar - 首页 / Home';
  }, [showSettings, showAdmin]);

  return (
    <>
      <AppShell
        activeSection={activeSection}
        onSectionChange={changeSection}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAdmin={() => setShowAdmin(true)}
        user={user}
        onLogout={logout}
      >
        {activeSection === 'today' ? <ActionCenterPage /> : activeSection === 'schedule' ? (
          <SchedulePage
            models={models}
            onRefreshModels={fetchModels}
            user={user}
          />
        ) : activeSection === 'reminders' ? (
          <ReminderPage />
        ) : <AiImportPage />}
      </AppShell>

      {/* 设置弹层 */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          onMouseDown={() => setShowSettings(false)}
        >
          <div
            className="settings-dialog-content rounded-2xl shadow-2xl overflow-hidden relative"
            style={{
              backgroundColor: 'var(--td-bg-color-container)',
              width: '680px',
              maxWidth: '95vw',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* 固定在右上角的关闭按钮 */}
            <button
              onClick={() => setShowSettings(false)}
              className="fixed p-1.5 rounded-lg hover:opacity-60 z-50"
              style={{
                top: 'calc(50vh - 42.5vh + 16px)',
                right: 'calc(50vw - 340px + 16px)',
                backgroundColor: 'var(--td-bg-color-container)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--td-text-color-secondary)' }}><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
            </button>
            <SettingsPage />
          </div>
        </div>
      )}

      {/* 管理员弹层 */}
      {showAdmin && (
        <AdminModal
          visible={showAdmin}
          onClose={() => setShowAdmin(false)}
        />
      )}
    </>
  );
}

export default App;
