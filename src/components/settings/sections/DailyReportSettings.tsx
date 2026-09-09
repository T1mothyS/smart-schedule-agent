import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, MessagePlugin } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';
import type { DailyReportTokenStatus, SettingsAuthHeaders } from '../types';

const DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES = 200_000;

interface DailyReportCloudContextEnvelope {
  version: number;
  context: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

interface SelectedCloudContextFile {
  name: string;
  size: number;
  keys: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(bytes < 1024 ? 0 : 1)} KB`;
}

export function DailyReportSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [dailyReportStatus, setDailyReportStatus] = useState<DailyReportTokenStatus | null>(null);
  const [dailyReportToken, setDailyReportToken] = useState('');
  const [dailyReportBusy, setDailyReportBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [cloudContext, setCloudContext] = useState<DailyReportCloudContextEnvelope | null>(null);
  const [cloudContextFile, setCloudContextFile] = useState<SelectedCloudContextFile | null>(null);
  const [cloudContextValue, setCloudContextValue] = useState<Record<string, unknown> | null>(null);
  const [cloudContextBusy, setCloudContextBusy] = useState(false);
  const [cloudContextError, setCloudContextError] = useState('');
  const cloudContextFileInputRef = useRef<HTMLInputElement>(null);
  const loadDailyReportStatus = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/integrations/daily-report-token', { headers: authHeaders() });
      if (!response.ok) throw new Error('读取令牌状态失败');
      const result = await response.json();
      setDailyReportStatus(result.status);
    } catch { setLoadError('日报令牌状态加载失败，请重试。'); }
  }, [authHeaders]);

  const loadCloudContext = useCallback(async () => {
    setCloudContextError('');
    try {
      const response = await fetch('/api/daily-report/cloud-context', { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '读取云端 Context 状态失败');
      setCloudContext(result.context as DailyReportCloudContextEnvelope);
    } catch (error: any) {
      setCloudContextError(error?.message || '云端 Context 状态加载失败，请重试。');
    }
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

  const selectCloudContextFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    setCloudContextFile(null);
    setCloudContextValue(null);
    setCloudContextError('');
    if (!file) return;
    if (file.size > DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES) {
      setCloudContextError(`文件不能超过 ${DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES.toLocaleString()} 字节。`);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isObject(parsed)) throw new Error('文件内容必须是 JSON 对象。');
      const encoded = JSON.stringify(parsed);
      if (new TextEncoder().encode(encoded).byteLength > DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES) {
        throw new Error(`Context 不能超过 ${DAILY_REPORT_CLOUD_CONTEXT_MAX_BYTES.toLocaleString()} 字节。`);
      }
      setCloudContextValue(parsed);
      setCloudContextFile({ name: file.name, size: file.size, keys: Object.keys(parsed) });
    } catch (error: any) {
      setCloudContextError(error?.message || '无法读取 JSON 文件。');
    }
  };

  const uploadCloudContext = async () => {
    if (!cloudContextValue) return;
    setCloudContextBusy(true);
    setCloudContextError('');
    try {
      const response = await fetch('/api/daily-report/cloud-context', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: cloudContextValue }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '上传云端 Context 失败');
      setCloudContext(result.context as DailyReportCloudContextEnvelope);
      setCloudContextFile(null);
      setCloudContextValue(null);
      if (cloudContextFileInputRef.current) cloudContextFileInputRef.current.value = '';
      MessagePlugin.success('脱敏 Context 已上传到云端');
    } catch (error: any) {
      setCloudContextError(error?.message || '上传云端 Context 失败，请重试。');
    } finally {
      setCloudContextBusy(false);
    }
  };


  useEffect(() => { void loadDailyReportStatus(); void loadCloudContext(); }, [loadDailyReportStatus, loadCloudContext]);
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
      <SettingRow label="云端 Context" description="上传日报 V2 导出的脱敏 JSON，供 ChatGPT Work shadow 任务读取。服务端会再次拒绝凭据、令牌、本地路径和过大内容。">
        <div className="settings-stack">
          <div className="settings-status" role="status">
            {cloudContextError && <strong className="settings-error-text">{cloudContextError}</strong>}
            {!cloudContextError && !cloudContext && <strong>加载状态中…</strong>}
            {!cloudContextError && cloudContext && <>
              <strong>{cloudContext.version > 0 ? `已同步版本 v${cloudContext.version}` : '尚未上传'}</strong>
              <span>已保存顶层键：{Object.keys(cloudContext.context).join('、') || '无'}</span>
              {cloudContext.updatedAt && <span>最近更新：{new Date(cloudContext.updatedAt).toLocaleString('zh-CN')}</span>}
            </>}
          </div>
          <input
            ref={cloudContextFileInputRef}
            className="settings-file-input"
            type="file"
            accept="application/json,.json"
            aria-label="选择脱敏 Context JSON"
            onChange={event => { void selectCloudContextFile(event); }}
          />
          {cloudContextFile && <p className="settings-help">已读取 {cloudContextFile.name} · {formatBytes(cloudContextFile.size)} · 顶层键：{cloudContextFile.keys.join('、') || '无'}。页面不会展示文件正文。</p>}
          <div className="settings-actions">
            <Button tag="button" loading={cloudContextBusy} disabled={!cloudContextValue || cloudContextBusy} onClick={() => void uploadCloudContext()}>上传脱敏 Context</Button>
            <Button tag="button" variant="outline" loading={!cloudContext && !cloudContextError} disabled={cloudContextBusy} onClick={() => void loadCloudContext()}>刷新云端状态</Button>
          </div>
          <p className="settings-note">仅上传一次性脱敏 Context；Calendar、邮箱和动态运行状态仍由服务端按权限实时读取。本操作不会改变本地日报链路。</p>
        </div>
      </SettingRow>
    </SettingSection>
  );
}
