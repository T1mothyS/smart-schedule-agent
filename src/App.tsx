import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useLocation, useSearchParams, Navigate } from 'react-router-dom';
import { useTheme } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';
import { CalendarDays, Check, Mail, MessageCircle, MoonStar, PartyPopper, RotateCcw, StickyNote, X } from 'lucide-react';

import { SettingsDialog } from './components/settings/SettingsDialog';
import { AdminModal } from './components/AdminModal';
import { AiSchedulePanel, type AiSchedulePanelHandle } from './components/AiSchedulePanel';
import { AiNoteBoardHost, useAiNoteBoard } from './components/AiNoteBoardHost';
import { CalendarView } from './components/CalendarView';
import { ScheduleSidebar } from './components/ScheduleSidebar';
import { LoginPage } from './pages/LoginPage';
import { ReminderPage } from './components/ReminderPage';
import { AppShell } from './components/AppShell';
import { ActionCenterPage } from './components/ActionCenterPage';
import { AiImportPage } from './components/AiImportPage';
import { DailyReportReaderPage, DailyReportsPage } from './components/DailyReportsPage';
import { LibraryPage } from './components/LibraryPage';
import { MiniMonthCalendar } from './components/calendar/MiniMonthCalendar';
import { SCHEDULE_CATEGORIES } from './utils/scheduleCategories';

// ==================== 日程主页（三栏布局） ====================

interface SchedulePageProps {
  theme?: string;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  onOpenReminders?: () => void;
  user?: { id: string; email: string; role: 'admin' | 'user' } | null;
  onLogout?: () => void;
}

function AiAssistantPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTool = searchParams.get('tool') === 'email-import' ? 'email-import' : 'chat';
  const chatPanelRef = useRef<AiSchedulePanelHandle>(null);
  const [chatState, setChatState] = useState({ hasMessages: false, busy: false });
  const sendNoteToAi = useCallback((note: Parameters<AiSchedulePanelHandle['sendNoteToAi']>[0]) => {
    chatPanelRef.current?.sendNoteToAi(note);
  }, []);
  const noteBoard = useAiNoteBoard({
    initialNoteId: searchParams.get('note') || undefined,
    onSendToAi: sendNoteToAi,
  });
  const saveNote = useCallback((content: string) => noteBoard.createNote(content), [noteBoard.createNote]);

  const selectTool = (tool: 'chat' | 'email-import') => {
    const next = new URLSearchParams(searchParams);
    if (tool === 'email-import') next.set('tool', tool);
    else next.delete('tool');
    setSearchParams(next);
  };

  const resetDisabled = activeTool !== 'chat' || chatState.busy || !chatState.hasMessages;
  const resetTitle = activeTool !== 'chat'
    ? '邮箱导入模式没有对话历史可重置'
    : chatState.busy
      ? '正在处理，暂时不能重置对话'
      : chatState.hasMessages ? '重置对话' : '当前没有可重置的对话';

  return (
    <div className="ai-assistant-page">
      <div className="ai-assistant-page-main">
        <header className="ai-assistant-topbar">
          <div className="ai-assistant-topbar-title">
            <span className="eyebrow">AI WORKSPACE</span>
            <strong>AI 对话</strong>
          </div>
          <nav className="ai-assistant-tabs" role="tablist" aria-label="AI 工作区">
            <button
              type="button"
              role="tab"
              id="ai-tab-chat"
              aria-controls="ai-panel-content"
              aria-selected={activeTool === 'chat'}
              className={`ai-assistant-tab${activeTool === 'chat' ? ' active' : ''}`}
              onClick={() => selectTool('chat')}
            >
              <MessageCircle size={16} aria-hidden="true" />
              <span>AI 对话</span>
            </button>
            <button
              type="button"
              role="tab"
              id="ai-tab-email-import"
              aria-controls="ai-panel-content"
              aria-selected={activeTool === 'email-import'}
              className={`ai-assistant-tab${activeTool === 'email-import' ? ' active' : ''}`}
              onClick={() => selectTool('email-import')}
            >
              <Mail size={16} aria-hidden="true" />
              <span>邮箱导入</span>
            </button>
          </nav>
          <div className="ai-assistant-topbar-actions">
            <button
              type="button"
              className="ai-workspace-action"
              onClick={() => { void chatPanelRef.current?.resetHistory(); }}
              disabled={resetDisabled}
              title={resetTitle}
              aria-label={resetTitle}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>重置</span>
            </button>
            <button
              type="button"
              className="ai-workspace-action ai-workspace-note-action"
              onClick={noteBoard.toggleDrawer}
              aria-expanded={noteBoard.drawerOpen}
              aria-controls="ai-note-board"
              title="打开 AI 记事板"
              aria-label="打开 AI 记事板"
            >
              <StickyNote size={16} aria-hidden="true" />
              <span>记事板</span>
              {noteBoard.pendingCount > 0 && <em aria-label={`${noteBoard.pendingCount} 条未完成记事`}>{noteBoard.pendingCount}</em>}
            </button>
          </div>
        </header>
        <section
          id="ai-panel-content"
          className="ai-assistant-tool-content"
          role="tabpanel"
          aria-labelledby={activeTool === 'chat' ? 'ai-tab-chat' : 'ai-tab-email-import'}
        >
          {activeTool === 'email-import' ? (
            <AiImportPage />
          ) : (
            <div className="ai-schedule-page">
              <section className="ai-schedule-page-card">
                <AiSchedulePanel
                  ref={chatPanelRef}
                  onSaveNote={saveNote}
                  onChatStateChange={setChatState}
                />
              </section>
            </div>
          )}
        </section>
      </div>
      <AiNoteBoardHost controller={noteBoard} aiBusy={chatState.busy} />
    </div>
  );
}

function SchedulePage({ user }: SchedulePageProps) {
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
          <Route path="/import" element={<Navigate to="/assistant?tool=email-import" replace />} />
          <Route path="/reports" element={<AppContent />} />
          <Route path="/reports/:date" element={<DailyReportReaderPage />} />
          <Route path="/library" element={<AppContent />} />
          <Route path="/library/:id" element={<AppContent />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </>
      )}
    </Routes>
  );
}

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection = location.pathname.startsWith('/reports') ? 'reports' : location.pathname.startsWith('/library') ? 'library' : location.pathname === '/schedule' ? 'schedule' : location.pathname === '/assistant' ? 'assistant' : location.pathname === '/reminders' ? 'reminders' : 'today';
  const changeSection = (section: 'today' | 'schedule' | 'assistant' | 'reminders' | 'reports' | 'library') => navigate(section === 'schedule' ? '/schedule' : section === 'assistant' ? '/assistant' : section === 'reminders' ? '/reminders' : section === 'reports' ? '/reports' : section === 'library' ? '/library' : '/today');

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
          <SchedulePage user={user} />
        ) : activeSection === 'assistant' ? <AiAssistantPage /> : activeSection === 'reminders' ? (
          <ReminderPage />
        ) : activeSection === 'reports' ? <DailyReportsPage /> : activeSection === 'library' ? <LibraryPage /> : <ActionCenterPage />}
      </AppShell>

      {showSettings && <SettingsDialog
        onClose={() => setShowSettings(false)}
        onOpenAdmin={() => { setShowSettings(false); setShowAdmin(true); }}
      />}

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
