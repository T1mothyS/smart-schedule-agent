import { ReactNode } from 'react';
import { BellRing, BookOpen, Moon, Newspaper, Settings, Shield, Sun, type LucideIcon } from 'lucide-react';
import { GlobalSearch } from './GlobalSearch';

type Section = 'today' | 'schedule' | 'assistant' | 'reminders' | 'import' | 'reports' | 'library';

const productNavItems: Array<{ section: Section; label: string; icon?: string; Icon?: LucideIcon }> = [
  { section: 'today', label: '今日', icon: '/navigation-icons/today.png' },
  { section: 'schedule', label: '日程', icon: '/navigation-icons/schedule.png' },
  { section: 'reminders', label: '周期提醒', icon: '/navigation-icons/reminders.png' },
  { section: 'import', label: '智能导入', icon: '/navigation-icons/import.png' },
  { section: 'assistant', label: 'AI 助手', icon: '/navigation-icons/assistant.png' },
  { section: 'reports', label: '日报', Icon: Newspaper },
  { section: 'library', label: '知识库', Icon: BookOpen },
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
              className={`product-nav-item icon-only${activeSection === item.section ? ' active' : ''}`}
              onClick={() => onSectionChange(item.section)}
              title={item.label}
              aria-label={item.label}
            >
              {item.icon ? <img className="product-nav-image" src={item.icon} alt="" aria-hidden="true" /> : item.Icon ? <item.Icon className="product-nav-lucide" size={26} strokeWidth={1.8} aria-hidden="true" /> : null}
            </button>
          ))}
        </nav>

        <div className="topbar-actions">
          <span className="user-chip" title={user?.email}>{user?.email}</span>
          <GlobalSearch />
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
