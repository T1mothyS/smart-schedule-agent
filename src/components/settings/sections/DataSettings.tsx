import { useState } from 'react';
import { Button, MessagePlugin } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow, SettingInput } from '../SettingRow';
import type { SettingsAuthHeaders } from '../types';

interface BackupPreview {
  exportedAt: string;
  sourceEmail?: string;
  counts: { schedules: number; reminderTasks: number; completions: number; attachments: number };
}

export function DataSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [backupPassword, setBackupPassword] = useState('');
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState<'json' | 'csv' | null>(null);
  const encodedBackupPassword = () => {
    const bytes = new TextEncoder().encode(backupPassword);
    let binary = '';
    bytes.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary);
  };

  const exportBackup = async () => {
    if (backupPassword.length < 8) return MessagePlugin.warning('备份密码至少需要 8 个字符');
    setBackupBusy(true);
    try {
      const response = await fetch('/api/backups/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ password: backupPassword }),
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '导出失败'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ai-calendar-' + new Date().toISOString().slice(0, 10) + '.aicalendar-backup';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      MessagePlugin.success('加密备份已生成');
    } catch (error: any) { MessagePlugin.error(error?.message || '导出失败'); }
    finally { setBackupBusy(false); }
  };

  const inspectBackup = async (file: File) => {
    if (backupPassword.length < 8) return MessagePlugin.warning('请先输入该备份的密码');
    setBackupBusy(true);
    setBackupFile(file);
    setBackupPreview(null);
    try {
      const response = await fetch('/api/backups/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': encodedBackupPassword(), ...authHeaders() },
        body: await file.arrayBuffer(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '检查备份失败');
      setBackupPreview(data.backup);
    } catch (error: any) { setBackupPreview(null); MessagePlugin.error(error?.message || '检查备份失败'); }
    finally { setBackupBusy(false); }
  };

  const restoreBackup = async (mode: 'merge' | 'replace') => {
    if (!backupFile || !backupPreview) return;
    if (mode === 'replace' && !window.confirm('替换模式会先备份当前数据，然后替换当前账号的日历、周期事务和历史。是否继续？')) return;
    setBackupBusy(true);
    try {
      const response = await fetch('/api/backups/restore?mode=' + mode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': encodedBackupPassword(), ...authHeaders() },
        body: await backupFile.arrayBuffer(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '恢复失败');
      MessagePlugin.success('数据恢复完成，刷新页面后生效');
      setBackupFile(null); setBackupPreview(null);
    } catch (error: any) { MessagePlugin.error(error?.message || '恢复失败'); }
    finally { setBackupBusy(false); }
  };

  const downloadReadableExport = async (format: 'json' | 'csv') => {
    setExportBusy(format);
    try {
      const response = await fetch(format === 'json' ? '/api/exports/user-data.json' : '/api/exports/schedules.csv', {
        headers: authHeaders(),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '导出失败');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = format === 'json'
        ? `ai-calendar-data-${new Date().toISOString().slice(0, 10)}.json`
        : `ai-calendar-schedules-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      MessagePlugin.success(format === 'json' ? 'JSON 数据已导出' : 'CSV 日程表已导出');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '导出失败');
    } finally {
      setExportBusy(null);
    }
  };


  return (
    <SettingSection id="data" title="数据备份与恢复" description="仅处理当前账号的数据。加密备份包含个人日历、周期事务、记事、日报、完成历史和附件，不包含密码、角色或 API Key。">
      <SettingRow label="可读数据导出" description="JSON 包含非敏感业务数据；CSV 为日程表。附件文件请使用加密备份。">
        <div className="settings-actions"><Button tag="button" variant="outline" disabled={!!exportBusy} loading={exportBusy === 'json'} onClick={() => downloadReadableExport('json')}>下载 JSON</Button><Button tag="button" variant="outline" disabled={!!exportBusy} loading={exportBusy === 'csv'} onClick={() => downloadReadableExport('csv')}>下载 CSV</Button></div>
      </SettingRow>
      <SettingRow label="备份密码" htmlFor="settings-backup-password" description="至少 8 位。密码遗失后无法解密，服务器不会保存该密码。">
        <SettingInput id="settings-backup-password" type="password" value={backupPassword} disabled={backupBusy} onChange={value => { setBackupPassword(String(value)); setBackupPreview(null); setBackupFile(null); }} autocomplete="new-password" placeholder="设置或输入备份密码（至少 8 位）" />
        <div className="settings-actions"><Button tag="button" loading={backupBusy} disabled={backupBusy} onClick={exportBackup}>导出加密备份</Button></div>
      </SettingRow>
      <SettingRow label="选择备份文件" htmlFor="settings-backup-file" description="先填写该备份的密码，再选择文件检查内容。">
        <input id="settings-backup-file" className="settings-file-input" type="file" disabled={backupBusy} accept=".aicalendar-backup,application/octet-stream" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void inspectBackup(file); }} />
        {backupFile && <p className="settings-help">{backupFile.name}</p>}
        {backupPreview && <div className="settings-status">
          <strong>备份预览</strong>
          <span>备份时间：{new Date(backupPreview.exportedAt).toLocaleString('zh-CN')}</span>
          <span>来源账号：{backupPreview.sourceEmail || '未知'}</span>
          <span>日程 {backupPreview.counts.schedules} · 周期事务 {backupPreview.counts.reminderTasks} · 完成记录 {backupPreview.counts.completions} · 附件 {backupPreview.counts.attachments}</span>
          <div className="settings-actions"><Button tag="button" variant="outline" disabled={backupBusy} loading={backupBusy} onClick={() => restoreBackup('merge')}>合并恢复</Button><Button tag="button" theme="danger" variant="outline" disabled={backupBusy} loading={backupBusy} onClick={() => restoreBackup('replace')}>替换当前数据</Button></div>
        </div>}
      </SettingRow>
    </SettingSection>
  );
}
