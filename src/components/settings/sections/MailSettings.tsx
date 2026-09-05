import { useState, useEffect, useCallback } from 'react';
import { Button, MessagePlugin, Switch } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow, SettingInput } from '../SettingRow';
import type { UserMailAccountStatus, SettingsAuthHeaders } from '../types';

export function MailSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [mailAccount, setMailAccount] = useState<UserMailAccountStatus | null>(null);
  const [mailUsername, setMailUsername] = useState('');
  const [mailAuthCode, setMailAuthCode] = useState('');
  const [mailEnabled, setMailEnabled] = useState(true);
  const [mailAccountBusy, setMailAccountBusy] = useState(false);

  const [loadError, setLoadError] = useState('');
  const loadUserMailAccount = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/user-mail-account', { headers: authHeaders() });
      if (!response.ok) throw new Error('读取邮箱配置失败');
      const result = await response.json();
      const account = result.account as UserMailAccountStatus;
      setMailAccount(account);
      setMailUsername(account.username || '');
      setMailEnabled(account.configured ? account.enabled : true);
    } catch { setLoadError('QQ 邮箱设置加载失败，请重试。'); }
  }, [authHeaders]);

  const saveUserMailAccount = async () => {
    if (!mailUsername.trim()) return MessagePlugin.warning('请输入 QQ 邮箱账号');
    setMailAccountBusy(true);
    try {
      const body: Record<string, unknown> = {
        username: mailUsername.trim(),
        enabled: mailEnabled,
      };
      if (mailAuthCode.trim()) body.authCode = mailAuthCode.trim();
      const response = await fetch('/api/user-mail-account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存 QQ 邮箱配置失败');
      setMailAccount(result.account);
      setMailUsername(result.account.username || '');
      setMailEnabled(!!result.account.enabled);
      setMailAuthCode('');
      MessagePlugin.success('QQ 邮箱配置已保存');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '保存 QQ 邮箱配置失败');
    } finally {
      setMailAccountBusy(false);
    }
  };

  const deleteUserMailAccount = async () => {
    if (!window.confirm('删除后，日报将无法读取 QQ 邮箱未读摘要。是否继续？')) return;
    setMailAccountBusy(true);
    try {
      const response = await fetch('/api/user-mail-account', { method: 'DELETE', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '删除 QQ 邮箱配置失败');
      setMailAccount(result.account);
      setMailUsername('');
      setMailAuthCode('');
      setMailEnabled(true);
      MessagePlugin.success('QQ 邮箱配置已删除');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '删除 QQ 邮箱配置失败');
    } finally {
      setMailAccountBusy(false);
    }
  };

  const testUserMailAccount = async () => {
    setMailAccountBusy(true);
    try {
      const response = await fetch('/api/user-mail-account/test', { method: 'POST', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'QQ 邮箱测试失败');
      const mailResult = result.result;
      if (mailResult?.status === 'OK') {
        MessagePlugin.success(`QQ 邮箱读取成功，发现 ${mailResult.unreadCount || 0} 封未读邮件`);
      } else {
        MessagePlugin.warning(mailResult?.error || 'QQ 邮箱暂时不可用');
      }
    } catch (error: any) {
      MessagePlugin.error(error?.message || 'QQ 邮箱测试失败');
    } finally {
      setMailAccountBusy(false);
    }
  };

  useEffect(() => { void loadUserMailAccount(); }, [loadUserMailAccount]);
  const disabled = mailAccountBusy || !mailAccount || !!loadError;
  return (
    <SettingSection id="mail" title="日报邮箱（QQ）" description="只读获取 QQ 收件箱未读摘要，不改变已读状态。授权码加密保存，页面不会再次显示；此处不影响官方发件邮箱。">
      {loadError && <div className="settings-status" role="alert">{loadError}<Button tag="button" variant="outline" onClick={loadUserMailAccount}>重试邮箱设置</Button></div>}
      {!mailAccount && !loadError && <p className="settings-help" role="status">加载邮箱设置中…</p>}
      <SettingRow label="QQ 邮箱账号" htmlFor="settings-mail-username"><SettingInput id="settings-mail-username" value={mailUsername} onChange={value => setMailUsername(String(value))} autocomplete="email" placeholder="例如：name@qq.com" disabled={disabled} /></SettingRow>
      <SettingRow label="客户端授权码" htmlFor="settings-mail-auth-code" description="在 QQ 邮箱中开启 IMAP 并获取客户端授权码。"><SettingInput id="settings-mail-auth-code" type="password" value={mailAuthCode} onChange={value => setMailAuthCode(String(value))} autocomplete="new-password" placeholder={mailAccount?.configured ? '留空表示沿用已保存授权码' : '首次保存必须填写'} disabled={disabled} /></SettingRow>
      <SettingRow label="启用日报读取"><Switch aria-label="启用日报读取" aria-checked={mailEnabled} value={mailEnabled} onChange={value => setMailEnabled(Boolean(value))} disabled={disabled} /></SettingRow>
      <SettingRow label="配置状态">
        <p className="settings-help" role="status">{mailAccount?.configured ? `当前账号：${mailAccount.username} · ${mailAccount.enabled ? '已启用' : '已停用'}${mailAccount.updatedAt ? ` · 更新于 ${new Date(mailAccount.updatedAt).toLocaleString('zh-CN')}` : ''}` : '尚未配置 QQ 邮箱。'}{mailAccount && !mailAccount.encryptionConfigured && ' 服务器尚未配置邮箱凭据加密密钥，暂时无法保存。'}</p>
        <div className="settings-actions">
          <Button tag="button" loading={mailAccountBusy} disabled={disabled || !mailAccount?.encryptionConfigured} onClick={saveUserMailAccount}>保存邮箱配置</Button>
          {mailAccount?.configured && <Button tag="button" variant="outline" loading={mailAccountBusy} disabled={disabled} onClick={testUserMailAccount}>测试读取</Button>}
          {mailAccount?.configured && <Button tag="button" theme="danger" variant="text" loading={mailAccountBusy} disabled={disabled} onClick={deleteUserMailAccount}>删除配置</Button>}
        </div>
      </SettingRow>
    </SettingSection>
  );
}
