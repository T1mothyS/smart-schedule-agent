import { useState, useEffect, useCallback } from 'react';
import { Button, MessagePlugin } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';
import type { DailyReportTokenStatus, SettingsAuthHeaders } from '../types';

export function DailyReportSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [dailyReportStatus, setDailyReportStatus] = useState<DailyReportTokenStatus | null>(null);
  const [dailyReportToken, setDailyReportToken] = useState('');
  const [dailyReportBusy, setDailyReportBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadDailyReportStatus = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/integrations/daily-report-token', { headers: authHeaders() });
      if (!response.ok) throw new Error('读取令牌状态失败');
      const result = await response.json();
      setDailyReportStatus(result.status);
    } catch { setLoadError('日报令牌状态加载失败，请重试。'); }
  }, [authHeaders]);

  const generateReportToken = async () => {
    if (dailyReportStatus?.active && !window.confirm('生成新令牌会立即使旧令牌失效。是否继续？')) return;
    setDailyReportBusy(true);
    try {
      const response = await fetch('/api/integrations/daily-report-token', { method: 'POST', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '生成令牌失败');
      setDailyReportToken(result.token);
      setDailyReportStatus(result.status);
      MessagePlugin.success('日报令牌已生成，请立即复制保存');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '生成令牌失败');
    } finally {
      setDailyReportBusy(false);
    }
  };

  const revokeReportToken = async () => {
    if (!window.confirm('撤销后，日报项目将无法读取日程、邮箱摘要或发布日报。是否继续？')) return;
    setDailyReportBusy(true);
    try {
      const response = await fetch('/api/integrations/daily-report-token', { method: 'DELETE', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '撤销令牌失败');
      setDailyReportToken('');
      setDailyReportStatus(result.status);
      MessagePlugin.success('日报令牌已撤销');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '撤销令牌失败');
    } finally {
      setDailyReportBusy(false);
    }
  };


  useEffect(() => { void loadDailyReportStatus(); }, [loadDailyReportStatus]);
  return (
    <SettingSection id="daily-report" title="日报集成" description="令牌允许读取当前账号的日程与 QQ 未读摘要，以及上传日报媒体、发布日报。不能修改日程，也不会返回邮箱授权码、附件、密码或 API Key。">
      <SettingRow label="日报令牌">
        <div className="settings-status" role="status">
          <strong>{loadError || (dailyReportStatus?.active ? '已启用' : dailyReportStatus?.exists ? '已撤销' : dailyReportStatus ? '尚未生成' : '加载状态中…')}</strong>
          {dailyReportStatus?.prefix && <span>令牌前缀：{dailyReportStatus.prefix}…</span>}
          {dailyReportStatus?.lastUsedAt && <span>最近使用：{new Date(dailyReportStatus.lastUsedAt).toLocaleString('zh-CN')}</span>}
          {loadError && <Button tag="button" variant="outline" onClick={loadDailyReportStatus}>重试令牌状态</Button>}
        </div>
        {dailyReportToken && <div className="settings-token-once"><strong>只显示一次</strong><span>关闭设置后无法再次查看明文，请立即保存。</span><code>{dailyReportToken}</code><div className="settings-actions"><Button tag="button" onClick={async () => { try { await navigator.clipboard.writeText(dailyReportToken); MessagePlugin.success('令牌已复制'); } catch { MessagePlugin.error('自动复制失败，请手动选择令牌'); } }}>复制令牌</Button></div></div>}
        <div className="settings-actions">
          <Button tag="button" loading={dailyReportBusy} disabled={!dailyReportStatus || !!loadError || dailyReportBusy} onClick={generateReportToken}>{dailyReportStatus?.active ? '轮换令牌' : '生成令牌'}</Button>
          {dailyReportStatus?.active && <Button tag="button" theme="danger" variant="outline" loading={dailyReportBusy} disabled={dailyReportBusy} onClick={revokeReportToken}>撤销令牌</Button>}
        </div>
      </SettingRow>
    </SettingSection>
  );
}
