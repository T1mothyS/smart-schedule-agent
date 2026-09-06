import { useCallback, useEffect, useState } from 'react';
import { Button, MessagePlugin } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';
import type { SettingsAuthHeaders } from '../types';

interface LibraryTokenStatus {
  exists: boolean;
  active: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function LibraryIntegrationSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [status, setStatus] = useState<LibraryTokenStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadStatus = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/integrations/library-token', { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '读取知识库令牌状态失败');
      setStatus(result.status);
    } catch (error: any) {
      setLoadError(error?.message || '知识库令牌状态加载失败，请重试。');
    }
  }, [authHeaders]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const generate = async () => {
    if (status?.active && !window.confirm('生成新令牌会立即使旧令牌失效。是否继续？')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/integrations/library-token', { method: 'POST', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '生成知识库令牌失败');
      setToken(result.token || '');
      setStatus(result.status);
      MessagePlugin.success('知识库发布令牌已生成，请立即复制保存');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '生成知识库令牌失败');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm('撤销后，本地知识库 V2 将无法继续发布或更新内容。是否继续？')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/integrations/library-token', { method: 'DELETE', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '撤销知识库令牌失败');
      setToken('');
      setStatus(result.status);
      MessagePlugin.success('知识库发布令牌已撤销');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '撤销知识库令牌失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingSection id="library" title="知识库集成" description="令牌只允许当前账号的本地知识库 V2 发布和更新正式 Markdown。它不能登录网页，也不能读取、评论、修改日程、记事或其他账号数据。服务器只保存令牌哈希。">
      <SettingRow label="知识库发布令牌">
        <div className="settings-status" role="status">
          <strong>{loadError || (status?.active ? '已启用' : status?.exists ? '已撤销' : status ? '尚未生成' : '加载状态中…')}</strong>
          {status?.prefix && <span>令牌前缀：{status.prefix}…</span>}
          {status?.lastUsedAt && <span>最近使用：{new Date(status.lastUsedAt).toLocaleString('zh-CN')}</span>}
          {loadError && <Button tag="button" variant="outline" onClick={loadStatus}>重试令牌状态</Button>}
        </div>
        {token && <div className="settings-token-once"><strong>只显示一次</strong><span>关闭设置后无法再次查看明文，请只保存在本地当前 PowerShell 会话中。</span><code>{token}</code><div className="settings-actions"><Button tag="button" onClick={async () => { try { await navigator.clipboard.writeText(token); MessagePlugin.success('令牌已复制'); } catch { MessagePlugin.error('自动复制失败，请手动选择令牌'); } }}>复制令牌</Button></div></div>}
        <div className="settings-actions">
          <Button tag="button" loading={busy} disabled={!status || !!loadError || busy} onClick={generate}>{status?.active ? '轮换令牌' : '生成令牌'}</Button>
          {status?.active && <Button tag="button" theme="danger" variant="outline" loading={busy} disabled={busy} onClick={revoke}>撤销令牌</Button>}
        </div>
      </SettingRow>
    </SettingSection>
  );
}
