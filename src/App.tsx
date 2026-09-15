import { CalendarDays } from 'lucide-react';
import { lazy, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ActionCenterPage } from './components/ActionCenterPage';
import { AppShell } from './components/AppShell';
import { FeatureBoundary } from './components/FeatureBoundary';
import { useAuth } from './hooks/useAuth';
import { useTheme } from './hooks/useTheme';
import { LoginPage } from './pages/LoginPage';

const SettingsDialog = lazy(() => import('./components/settings/SettingsDialog').then(module => ({ default: module.SettingsDialog })));
const AdminModal = lazy(() => import('./components/AdminModal').then(module => ({ default: module.AdminModal })));
const SchedulePage = lazy(() => import('./pages/SchedulePage').then(module => ({ default: module.SchedulePage })));
const AiAssistantPage = lazy(() => import('./pages/AiAssistantPage').then(module => ({ default: module.AiAssistantPage })));
const ReminderPage = lazy(() => import('./components/ReminderPage').then(module => ({ default: module.ReminderPage })));
const DailyReportsPage = lazy(() => import('./components/DailyReportsPage').then(module => ({ default: module.DailyReportsPage })));
const DailyReportReaderPage = lazy(() => import('./components/DailyReportsPage').then(module => ({ default: module.DailyReportReaderPage })));
const LibraryPage = lazy(() => import('./components/LibraryPage').then(module => ({ default: module.LibraryPage })));

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
          <Route path="/reports/:date" element={<FeatureBoundary key={location.pathname}><DailyReportReaderPage /></FeatureBoundary>} />
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
  const settingsTriggerRef = useRef<HTMLElement | null>(null);
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
        onOpenSettings={() => { settingsTriggerRef.current = document.activeElement as HTMLElement; setShowSettings(true); }}
        onOpenAdmin={() => setShowAdmin(true)}
        user={user}
        onLogout={logout}
      >
        <FeatureBoundary key={activeSection}>
        {activeSection === 'today' ? <ActionCenterPage /> : activeSection === 'schedule' ? (
          <SchedulePage user={user} />
        ) : activeSection === 'assistant' ? <AiAssistantPage /> : activeSection === 'reminders' ? (
          <ReminderPage />
        ) : activeSection === 'reports' ? <DailyReportsPage /> : activeSection === 'library' ? <LibraryPage /> : <ActionCenterPage />}
        </FeatureBoundary>
      </AppShell>

      {showSettings && <FeatureBoundary onClose={() => { setShowSettings(false); settingsTriggerRef.current?.focus(); }}><SettingsDialog
        restoreFocusTo={settingsTriggerRef.current}
        onClose={() => setShowSettings(false)}
        onOpenAdmin={() => { setShowSettings(false); setShowAdmin(true); }}
      /></FeatureBoundary>}

      {/* 管理员弹层 */}
      {showAdmin && (
        <FeatureBoundary onClose={() => setShowAdmin(false)}>
        <AdminModal
          visible={showAdmin}
          onClose={() => setShowAdmin(false)}
        />
        </FeatureBoundary>
      )}
    </>
  );
}

export default App;
