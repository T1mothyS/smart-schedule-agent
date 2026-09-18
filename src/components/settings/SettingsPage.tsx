import { useAuth } from '../../hooks/useAuth';
import { SettingsLayout } from './SettingsLayout';
import { AccountSettings } from './sections/AccountSettings';
import { AiSettings } from './sections/AiSettings';
import { IntegrationGuideSettings } from './sections/IntegrationGuideSettings';
import { NotificationSettings } from './sections/NotificationSettings';
import { DailyReportSettings } from './sections/DailyReportSettings';
import { LibraryIntegrationSettings } from './sections/LibraryIntegrationSettings';
import { MailSettings } from './sections/MailSettings';
import { DataSettings } from './sections/DataSettings';
import { AdminSettings } from './sections/AdminSettings';
import { ToolsSettings } from './sections/ToolsSettings';
import { CaldavSettings } from './sections/CaldavSettings';

export function SettingsPage({ onOpenAdmin, onOpenTools }: { onOpenAdmin?: () => void; onOpenTools?: () => void }) {
  const { user, authHeaders, logout, isLoading } = useAuth();
  if (isLoading) return <p className="settings-empty" role="status">正在加载账号设置…</p>;
  if (!user) return <p className="settings-empty" role="alert">无法读取当前账号，请关闭设置后重新登录。</p>;

  return (
    <SettingsLayout isAdmin={user.role === 'admin'}>
      <AccountSettings user={user} onLogout={logout} />
      <AiSettings authHeaders={authHeaders} />
      <IntegrationGuideSettings authHeaders={authHeaders} />
      <CaldavSettings authHeaders={authHeaders} />
      <NotificationSettings authHeaders={authHeaders} userEmail={user.email} />
      <DailyReportSettings authHeaders={authHeaders} />
      <LibraryIntegrationSettings authHeaders={authHeaders} />
      <ToolsSettings onOpenTools={onOpenTools} />
      <MailSettings authHeaders={authHeaders} />
      <DataSettings authHeaders={authHeaders} />
      {user.role === 'admin' && <AdminSettings onOpenAdmin={onOpenAdmin} />}
    </SettingsLayout>
  );
}
