import { ReactNode } from 'react';
import { BellRing, Moon, Settings, Shield, Sun } from 'lucide-react';

type Section = 'today' | 'schedule' | 'assistant' | 'reminders' | 'import';

const productNavItems: Array<{ section: Section; label: string; icon: string }> = [
  { section: 'today', label: '今日', icon: '/navigation-icons/today.png' },
  { section: 'schedule', label: '日程', icon: '/navigation-icons/schedule.png' },
  { section: 'reminders', label: '周期提醒', icon: '/navigation-icons/reminders.png' },
  { section: 'import', label: '智能导入', icon: '/navigation-icons/import.png' },
  { section: 'assistant', label: 'AI 助手', icon: '/navigation-icons/assistant.png' },
];

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
          {productNavItems.map(item => (
            <button
              key={item.section}
              className={`product-nav-item icon-only${item.section === 'assistant' ? ' ai-assistant-nav' : ''}${activeSection === item.section ? ' active' : ''}`}
              onClick={() => onSectionChange(item.section)}
              title={item.label}
              aria-label={item.label}
            >
              <img className="product-nav-image" src={item.icon} alt="" aria-hidden="true" />
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <span className="user-chip" title={user?.email}>{user?.email}</span>
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
