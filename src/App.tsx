import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import '@tdesign-react/chat/es/style/index.js';

import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import { useAuth } from './hooks/useAuth';

import { SettingsPage } from './components/SettingsPage';
import { AdminModal } from './components/AdminModal';
import { AiSchedulePanel } from './components/AiSchedulePanel';
import { CalendarView } from './components/CalendarView';
import { ScheduleSidebar } from './components/ScheduleSidebar';
import { LoginPage } from './pages/LoginPage';
import { ReminderPage } from './components/ReminderPage';
import { AppShell } from './components/AppShell';

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
      {/* 主体三栏 */}
      <div className="flex flex-1 overflow-hidden schedule-workspace-body">
        {/* 左侧：日程表管理侧边栏 */}
        <div
          className="w-44 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: '1px solid var(--td-component-stroke)' }}
        >
          <ScheduleSidebar
            activeCalendarIds={activeCalendarIds}
            onActiveChange={handleActiveChange}
            onCalendarsLoaded={handleCalendarsLoaded}
          />
        </div>

        {/* 中间：AI 对话面板 */}
        <div
          className="w-72 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: '1px solid var(--td-component-stroke)' }}
        >
          <AiSchedulePanel
            onSchedulesCreated={handleSchedulesCreated}
            activeCalendarIds={activeCalendarIds}
          />
        </div>

        {/* 右侧：日历视图 */}
        <div className="flex-1 overflow-hidden">
          <CalendarView
            refreshKey={calendarRefreshKey}
            activeCalendarIds={activeCalendarIds}
          />
        </div>
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
          <div className="text-4xl mb-3">📅</div>
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
          <Route path="/schedule" element={<AppContent />} />
          <Route path="*" element={<Navigate to="/schedule" replace />} />
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
  const [activeSection, setActiveSection] = useState<'schedule' | 'reminders'>('schedule');

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
        onSectionChange={setActiveSection}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAdmin={() => setShowAdmin(true)}
        user={user}
        onLogout={logout}
      >
        {activeSection === 'schedule' ? (
          <SchedulePage
            models={models}
            onRefreshModels={fetchModels}
          />
        ) : (
          <ReminderPage />
        )}
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
