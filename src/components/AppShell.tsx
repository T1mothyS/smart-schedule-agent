import { ReactNode } from 'react';
import { BellRing, Bot, CalendarDays, LayoutDashboard, Moon, Settings, Shield, Sparkles, Sun } from 'lucide-react';

type Section = 'today' | 'schedule' | 'assistant' | 'reminders' | 'import';

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
            className={activeSection === 'today' ? 'product-nav-item active' : 'product-nav-item'}
            onClick={() => onSectionChange('today')}
          >
            <LayoutDashboard className="product-nav-icon" size={16} /> 今日
          </button>
          <button
            className={activeSection === 'schedule' ? 'product-nav-item active' : 'product-nav-item'}
            onClick={() => onSectionChange('schedule')}
          >
            <CalendarDays className="product-nav-icon" size={16} /> 日程
          </button>
          <button
            className={activeSection === 'reminders' ? 'product-nav-item active' : 'product-nav-item'}
            onClick={() => onSectionChange('reminders')}
          >
            <BellRing className="product-nav-icon" size={16} /> 周期提醒
          </button>
          <button
            className={activeSection === 'import' ? 'product-nav-item active' : 'product-nav-item'}
            onClick={() => onSectionChange('import')}
          >
            <Sparkles className="product-nav-icon" size={16} /> 智能导入
          </button>
          <button
            className={activeSection === 'assistant' ? 'product-nav-item ai-assistant-nav active' : 'product-nav-item ai-assistant-nav'}
            onClick={() => onSectionChange('assistant')}
          >
            <Bot className="ai-assistant-nav-icon" size={22} strokeWidth={2.3} /> AI 助手
          </button>
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
