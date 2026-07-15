import { ReactNode } from 'react';
import { BellRing, CalendarDays, Mail, Moon, Settings, Shield, Sun } from 'lucide-react';

type Section = 'schedule' | 'reminders';

interface AppShellProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  theme: string;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenAdmin?: () => void;
  user?: { email: string; role: 'admin' | 'user' } | null;
  onLogout?: () => void;
  children: ReactNode;
}

export function AppShell({
  activeSection,
  onSectionChange,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenAdmin,
  user,
  onLogout,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="reminder-topbar app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><BellRing size={18} /></div>
          <div>
            <div className="brand-name">AI Calendar</div>
            <div className="brand-subtitle">日程与周期提醒</div>
          </div>
        </div>

        <nav className="product-nav" aria-label="产品导航">
          <button
            className={activeSection === 'schedule' ? 'product-nav-item active' : 'product-nav-item'}
            onClick={() => onSectionChange('schedule')}
          >
            <CalendarDays size={14} /> 日程
          </button>
          <button
            className={activeSection === 'reminders' ? 'product-nav-item active' : 'product-nav-item'}
            onClick={() => onSectionChange('reminders')}
          >
            <BellRing size={14} /> 周期提醒
          </button>
        </nav>

        <div className="topbar-actions">
          <span className="user-chip" title={user?.email}>{user?.email}</span>
          <button className="topbar-action topbar-email" onClick={onOpenSettings} title="设置提醒邮箱">
            <Mail size={15} />
            <span>提醒邮箱</span>
          </button>
          <button className="icon-button" onClick={onOpenSettings} title="设置" aria-label="打开设置">
            <Settings size={16} />
          </button>
          {user?.role === 'admin' && (
            <button className="icon-button" onClick={onOpenAdmin} title="管理面板" aria-label="打开管理面板">
              <Shield size={16} />
            </button>
          )}
          <button className="icon-button" onClick={onToggleTheme} title="切换主题" aria-label="切换主题">
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button className="text-button" onClick={() => { onLogout?.(); window.location.href = '/login'; }}>退出</button>
        </div>
      </header>
      <main className="app-shell-body">{children}</main>
    </div>
  );
}