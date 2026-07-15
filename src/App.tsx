import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useAuth } from './hooks/useAuth';
import { Bot, CalendarDays, PanelLeft, X } from 'lucide-react';

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

function SchedulePage({ theme, onToggleTheme, onOpenSettings, onOpenAdmin, onOpenReminders, user, onLogout }: SchedulePageProps) {
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [activeCalendarIds, setActiveCalendarIds] = useState<string[]>([]);
  const [calendarNames, setCalendarNames] = useState<Record<string, string>>({});
  const [scheduleTitle, setScheduleTitle] = useState('全部日程');
  const [showCalendarPanel, setShowCalendarPanel] = useState(true);
  const [showAiPanel, setShowAiPanel] = useState(false);

  const handleSchedulesCreated = useCallback(() => {
    setCalendarRefreshKey(prev => prev + 1);
  }, []);

  const handleActiveChange = useCallback((ids: string[]) => {
    setActiveCalendarIds(ids);
    const names = ids.map(id => calendarNames[id]).filter(Boolean);
    if (names.length === 0 || names.length === Object.keys(calendarNames).length) {
      setScheduleTitle('全部日程');
    } else {
      setScheduleTitle(names.join(' + '));
    }
  }, [calendarNames]);

  const handleCalendarsLoaded = useCallback((names: Record<string, string>) => {
    setCalendarNames(names);
  }, []);

  return (
    <div className="schedule-workspace">
      <div className="schedule-workspace-toolbar">
        <div>
          <button className={showCalendarPanel ? 'workspace-tool active' : 'workspace-tool'} onClick={() => setShowCalendarPanel(value => !value)}>
            <PanelLeft size={16} />
            日程表
          </button>
          <strong>{scheduleTitle}</strong>
        </div>
        <button className={showAiPanel ? 'workspace-tool active' : 'workspace-tool'} onClick={() => setShowAiPanel(value => !value)}>
          <Bot size={16} />
          AI 助手
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden schedule-workspace-body">
        {showCalendarPanel && <aside className="schedule-calendar-panel">
          <ScheduleSidebar
            activeCalendarIds={activeCalendarIds}
            onActiveChange={handleActiveChange}
            onCalendarsLoaded={handleCalendarsLoaded}
          />
        </aside>}

        <main className="flex-1 overflow-hidden schedule-calendar-main">
          <CalendarView
            refreshKey={calendarRefreshKey}
            activeCalendarIds={activeCalendarIds}
          />
        </main>
      </div>

      {showAiPanel && <aside className="schedule-ai-drawer">
        <button className="schedule-ai-close icon-button" onClick={() => setShowAiPanel(false)} title="关闭 AI 助手"><X size={16} /></button>
        <AiSchedulePanel
          onSchedulesCreated={handleSchedulesCreated}
          activeCalendarIds={activeCalendarIds}
        />
      </aside>}
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
