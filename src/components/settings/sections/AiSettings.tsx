import { useState, useEffect, useCallback } from 'react';
import { Button, MessagePlugin } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow, SettingInput } from '../SettingRow';
import type { SettingsAuthHeaders } from '../types';
import { ModelSettings } from './ModelSettings';

interface LoginStatus {
  isLoggedIn: boolean;
  checking: boolean;
  hasApiKey?: boolean;
  usingSharedApi?: boolean;
  apiKey?: string;
  error?: string;
}

export function AiSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  // ---------- 当前账号的 AI 凭据 ----------
  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [envConfig, setEnvConfig] = useState({
    apiKey: '',
    baseUrl: '',
  });
  const [savingEnv, setSavingEnv] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loginStatus, setLoginStatus] = useState<LoginStatus>({
    isLoggedIn: false,
    checking: true,
  });

  // 加载当前账号的 API Key
  const loadUserApiKey = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch('/api/user-api-key', { headers: authHeaders() });
      if (!res.ok) throw new Error('无法读取 AI 配置');
      const data = await res.json();
      setEnvConfig({ apiKey: '', baseUrl: data.baseUrl || '' });
      return true;
    } catch { MessagePlugin.error('无法读取 AI 配置，请重试'); return false; }
    finally { setLoadingConfig(false); }
  }, [authHeaders]);

  const checkLoginStatus = useCallback(async () => {
    setLoginStatus(prev => ({ ...prev, checking: true }));
    try {
      const res = await fetch('/api/check-login', {
        headers: authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        setLoginStatus({
          isLoggedIn: data.isLoggedIn ?? false,
          checking: false,
          hasApiKey: data.hasApiKey,
          usingSharedApi: data.usingSharedApi,
          apiKey: data.apiKey,
          error: data.error,
        });
      } else {
        setLoginStatus({ isLoggedIn: false, checking: false });
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        setLoginStatus({ isLoggedIn: false, checking: false, error: '检查超时，请重试' });
      } else {
        setLoginStatus({ isLoggedIn: false, checking: false, error: '无法连接服务器' });
      }
    }
  }, [authHeaders]);

  // 验证 API Key 可用性
  const [verifying, setVerifying] = useState(false);
  const verifyApiKey = useCallback(async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/verify-api-key', {
        method: 'POST',
        headers: authHeaders(),
        signal: AbortSignal.timeout(15000)
      });
      const data = await res.json();

      if (data.valid) {
        if (data.quotaExhausted) {
          // Key 有效但额度用完
          MessagePlugin.warning('API Key 有效，但额度已用完。请前往 CodeBuddy 控制台购买额度。', 6000);
        } else {
          MessagePlugin.success('API Key 验证成功！可用模型：' + data.modelCount + ' 个');
        }
      } else {
        MessagePlugin.error(data.error || 'API Key 验证失败');
      }
    } catch (e: any) {
      if (e.name === 'TimeoutError') {
        MessagePlugin.error('验证超时，请检查网络连接后重试');
      } else {
        MessagePlugin.error('验证失败：' + (e.message || '未知错误'));
      }
    } finally {
      setVerifying(false);
    }
  }, [authHeaders]);

  const saveEnvConfig = async () => {
    if (!envConfig.apiKey.trim()) {
      MessagePlugin.warning('请输入 API Key');
      return;
    }
    setSavingEnv(true);
    try {
      const response = await fetch('/api/user-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          apiKey: envConfig.apiKey.trim(),
          baseUrl: envConfig.baseUrl.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (data.success) {
        MessagePlugin.success('API Key 保存成功！');
        setShowEnvConfig(false);
        setEnvConfig({ apiKey: '', baseUrl: '' });
        await checkLoginStatus();
      } else {
        MessagePlugin.error(data.error || '保存失败');
      }
    } catch (error: any) {
      MessagePlugin.error(error?.message || '保存失败');
    } finally {
      setSavingEnv(false);
    }
  };


  useEffect(() => { void checkLoginStatus(); void loadUserApiKey(); }, [checkLoginStatus, loadUserApiKey]);

  return (
    <SettingSection id="ai" title="AI 设置" description="配置当前账号的 AI 凭据和日程助手模型。">
      <SettingRow label="AI 连接状态">
        <div className="settings-status" role="status">
          <strong>{loginStatus.checking ? '检查中…' : loginStatus.isLoggedIn ? '已配置' : '未连接'}</strong>
          {!loginStatus.checking && <span>{loginStatus.usingSharedApi ? '使用管理员共享 API，密钥仅在服务器端使用。' : loginStatus.hasApiKey ? `个人 API Key ${loginStatus.apiKey || ''}` : loginStatus.error || '请配置个人 API Key。'}</span>}
          <div className="settings-actions">
            <Button tag="button" variant="outline" loading={verifying} disabled={loginStatus.checking || savingEnv} onClick={verifyApiKey}>验证 Key</Button>
            <Button tag="button" variant="text" disabled={loginStatus.checking} onClick={checkLoginStatus}>刷新状态</Button>
          </div>
        </div>
      </SettingRow>
      <SettingRow label="个人 API Key" description="仅保存到当前账号，服务器不使用全局默认 Key。">
        {!showEnvConfig ? <div className="settings-actions">
          <Button tag="button" variant="outline" loading={loadingConfig} disabled={loadingConfig || savingEnv} onClick={async () => { if (await loadUserApiKey()) setShowEnvConfig(true); }}>{loginStatus.hasApiKey && !loginStatus.usingSharedApi ? '修改 API Key' : '配置 API Key'}</Button>
          <Button tag="a" variant="outline" href="https://www.workbuddy.cn/profile/keys" target="_blank" rel="noopener noreferrer">打开 WorkBuddy API 管理</Button>
        </div> : (
          <div className="settings-stack">
            <p className="settings-help">在 <a href="https://www.workbuddy.cn/profile/keys" target="_blank" rel="noopener noreferrer">WorkBuddy API 管理页面</a> 创建或复制 Key，然后粘贴到下方。</p>
            <label className="settings-field-label" htmlFor="settings-api-key">API Key（必填）</label>
            <SettingInput id="settings-api-key" type="password" className="settings-monospace" value={envConfig.apiKey} onChange={v => setEnvConfig(prev => ({ ...prev, apiKey: String(v) }))} placeholder={loginStatus.hasApiKey ? '输入新的 API Key 以覆盖当前配置' : '输入 API Key'} autocomplete="new-password" disabled={savingEnv} />
            <label className="settings-field-label" htmlFor="settings-base-url">Base URL（可选）</label>
            <SettingInput id="settings-base-url" value={envConfig.baseUrl} onChange={v => setEnvConfig(prev => ({ ...prev, baseUrl: String(v) }))} placeholder="https://api.codebuddy.cn" disabled={savingEnv} />
            <div className="settings-actions">
              <Button tag="button" theme="primary" onClick={saveEnvConfig} loading={savingEnv}>保存 API Key</Button>
              <Button tag="button" variant="text" disabled={savingEnv} onClick={() => { setShowEnvConfig(false); setEnvConfig({ apiKey: '', baseUrl: '' }); }}>取消</Button>
            </div>
          </div>
        )}
      </SettingRow>
      <ModelSettings authHeaders={authHeaders} />
    </SettingSection>
  );
}
