import { Button } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';
import type { SettingsUser } from '../types';

export function AccountSettings({ user, onLogout }: { user: SettingsUser; onLogout: () => void }) {
  return (
    <SettingSection id="account" title="当前账号" description="此处的设置仅用于当前登录账号。">
      <SettingRow label="登录邮箱">
        <div className="settings-account">
          <strong>{user.email}</strong>
          <span className="settings-badge">{user.role === 'admin' ? '管理员' : '普通用户'}</span>
        </div>
      </SettingRow>
      <SettingRow label="用户 ID"><code className="settings-user-id">{user.id}</code></SettingRow>
      <SettingRow label="登录状态">
        <div className="settings-actions">
          <span className="settings-status-text">已登录</span>
          <Button tag="button" variant="outline" onClick={async () => {
            try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* 本地仍可退出 */ }
            onLogout();
            window.location.href = '/login';
          }}>退出登录</Button>
        </div>
      </SettingRow>
    </SettingSection>
  );
}
