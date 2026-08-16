import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useAuth } from './hooks/useAuth';
import { CalendarDays, Check, MoonStar, PartyPopper, X } from 'lucide-react';

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
import { SCHEDULE_CATEGORIES } from './utils/scheduleCategories';

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

function AiAssistantPage() {
  return (
    <div className="ai-schedule-page">
      <section className="ai-schedule-page-card">
        <AiSchedulePanel />
      </section>
    </div>
  );
}

function SchedulePage({ user }: SchedulePageProps) {
  const [activeCategoryIds, setActiveCategoryIds] = useState<string[]>(() => SCHEDULE_CATEGORIES.map(category => category.id));
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isRailOpen, setIsRailOpen] = useState(false);
  const railCloseButtonRef = useRef<HTMLButtonElement>(null);
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
          <Route path="/assistant" element={<AppContent />} />
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
  const activeSection = location.pathname === '/schedule' ? 'schedule' : location.pathname === '/assistant' ? 'assistant' : location.pathname === '/reminders' ? 'reminders' : location.pathname === '/import' ? 'import' : 'today';
  const changeSection = (section: 'today' | 'schedule' | 'assistant' | 'reminders' | 'import') => navigate(section === 'schedule' ? '/schedule' : section === 'assistant' ? '/assistant' : section === 'reminders' ? '/reminders' : section === 'import' ? '/import' : '/today');

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
        ) : activeSection === 'assistant' ? <AiAssistantPage /> : activeSection === 'reminders' ? (
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
