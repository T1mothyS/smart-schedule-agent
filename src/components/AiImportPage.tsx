import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clipboard, Mail, RefreshCw, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface Draft {
  kind: 'schedule' | 'recurring';
  title: string;
  dueDate: string;
  dueTime: string | null;
  templateKey: string;
  recurrence: { frequency: string; interval: number; unit: string; advancePolicy: string };
  reminderOffsets: number[];
  actionGuide: string;
  notes: string;
  confidence: Record<string, number>;
  warnings: string[];
}

interface ImportRecord { id: string; status: string; draft: Draft; expiresAt: string }
interface EmailSetting { enabled: boolean; importToken: string }

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'true');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('当前浏览器不支持复制，请手动选择令牌');
}

export function AiImportPage() {
  const { authHeaders } = useAuth();
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingBusy, setSettingBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [emailSetting, setEmailSetting] = useState<EmailSetting | null>(null);
  const [pendingImports, setPendingImports] = useState<ImportRecord[]>([]);
  const [imapConfigured, setImapConfigured] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const loadPendingImports = useCallback(() => {
    return fetch('/api/ai/imports?status=draft', { headers: authHeaders() })
      .then(response => response.json())
      .then(data => setPendingImports(data.imports || []))
      .catch(() => undefined);
  }, [authHeaders]);

  useEffect(() => {
    fetch('/api/email-import/settings', { headers: authHeaders() })
      .then(response => response.json())
      .then(data => {
        setEmailSetting(data.setting || null);
        setImapConfigured(!!data.imapConfigured);
      })
      .catch(() => setNotice({ type: 'error', message: '邮箱导入设置暂时无法读取' }));
    void loadPendingImports();
  }, [authHeaders, loadPendingImports]);

  const update = (key: keyof Draft, value: any) => setDraft(current => current ? { ...current, [key]: value } : current);

  const confirm = async () => {
    if (!record || !draft) return;
    setBusy(true);
    try {
      const response = await fetch('/api/ai/imports/' + record.id + '/confirm', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '确认失败');
      setNotice({ type: 'success', message: draft.kind === 'recurring' ? '周期事务已创建' : '待办日程已创建' });
      setPendingImports(current => current.filter(item => item.id !== record.id));
      setRecord(null);
      setDraft(null);
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '确认失败' });
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!record) return;
    try {
      const response = await fetch('/api/ai/imports/' + record.id, { method: 'DELETE', headers: authHeaders() });
      if (!response.ok) throw new Error('丢弃草稿失败');
      setPendingImports(current => current.filter(item => item.id !== record.id));
      setNotice({ type: 'success', message: '草稿已丢弃' });
      setRecord(null);
      setDraft(null);
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '丢弃草稿失败' });
    }
  };

  const updateEmailSetting = async (enabled: boolean, regenerate = false) => {
    setSettingBusy(true);
    try {
      const response = await fetch('/api/email-import/settings', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, regenerate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '邮箱设置保存失败');
      setEmailSetting(data.setting);
      setNotice({ type: 'success', message: regenerate ? '令牌已重新生成' : enabled ? '邮箱导入已开启' : '邮箱导入已关闭' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '邮箱设置保存失败' });
    } finally {
      setSettingBusy(false);
    }
  };

  const copyToken = async () => {
    if (!emailSetting) return;
    try {
      await copyText(`[AI-IMPORT ${emailSetting.importToken}]`);
      setNotice({ type: 'success', message: '主题标记已复制，可直接粘贴到邮件主题' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '复制失败' });
    }
  };

  const checkEmailNow = async () => {
    setCheckingEmail(true);
    setNotice(null);
    try {
      const response = await fetch('/api/email-import/check', { method: 'POST', headers: authHeaders() });
      const data = await response.json();
      const message = data.result?.message || data.error || '邮箱检查失败';
      if (!response.ok) throw new Error(message);
      await loadPendingImports();
      setNotice({ type: 'success', message });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : '邮箱检查失败' });
    } finally {
      setCheckingEmail(false);
    }
  };

  const lowConfidence = (field: string) => (draft?.confidence?.[field] ?? 0) < .7;
  const tokenMarker = emailSetting ? `[AI-IMPORT ${emailSetting.importToken}]` : '';

  return <div className="ai-import-page">
    <header className="ai-import-header">
      <div>
        <div className="eyebrow">AI INBOX · EMAIL IMPORT</div>
        <h1>邮箱导入</h1>
        <p>把邮箱里收到的账单、通知和待办内容交给 AI，生成待确认草稿。</p>
      </div>
      <WandSparkles size={34} aria-hidden="true" />
    </header>

    {notice && <div className={'notice ' + notice.type} role="status">
      {notice.type === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
      <span>{notice.message}</span>
    </div>}

    <section className="ai-import-card ai-import-tutorial">
      <div className="ai-card-title"><Sparkles size={18} /><div><h2>四步开始使用</h2><span>AI 只会生成草稿，确认前不会写入正式日历。</span></div></div>
      <ol className="ai-import-steps">
        <li><b>开启</b><span>打开下方的邮箱导入开关。</span></li>
        <li><b>复制</b><span>复制专属主题标记，放进转发邮件主题。</span></li>
        <li><b>发送</b><span>把原邮件或需要识别的内容发送到已配置邮箱。</span></li>
        <li><b>确认</b><span>AI 生成草稿后，核对字段并确认或丢弃。</span></li>
      </ol>
      <div className="ai-import-safety-note"><Mail size={15} />邮箱只负责收集带有专属标记的邮件；服务端会按账号隔离，草稿默认保留有限时间。</div>
    </section>

    <section className="email-import-card ai-import-token-card">
      <div className="ai-card-title"><Mail size={18} /><div><h2>邮箱导入设置</h2><span>主题中包含专属标记，系统才会收集并交给 AI。</span></div></div>
      {!emailSetting ? <div className="ai-import-loading">正在读取邮箱导入设置…</div> : <>
        <div className="email-import-status-row">
          <span className={`email-import-status${emailSetting.enabled ? ' enabled' : ''}`}><i aria-hidden="true" />{emailSetting.enabled ? '邮箱导入已开启' : '邮箱导入未开启'}</span>
          <span className={imapConfigured ? 'email-import-configured' : 'email-import-unconfigured'}>{imapConfigured ? 'IMAP 已配置' : '服务端尚未配置 IMAP'}</span>
        </div>
        <div className="email-import-token-row">
          <code>{tokenMarker}</code>
          <button type="button" className="secondary-button" onClick={() => void copyToken()} disabled={settingBusy}>
            <Clipboard size={15} />复制主题标记
          </button>
        </div>
        <p className="email-import-token-hint">{imapConfigured ? '定时任务每 5 分钟检查一次；也可以点击“立即检查邮箱”。' : '需要管理员先配置 IMAP，当前页面无法读取邮箱内容。'}</p>
        <div className="email-import-actions">
          <button className="primary-button" onClick={() => void checkEmailNow()} disabled={!emailSetting.enabled || !imapConfigured || checkingEmail}>
            <RefreshCw size={15} className={checkingEmail ? 'spin' : undefined} />{checkingEmail ? '正在检查…' : '立即检查邮箱'}
          </button>
          <button className={emailSetting.enabled ? 'secondary-button' : 'primary-button'} onClick={() => void updateEmailSetting(!emailSetting.enabled)} disabled={settingBusy}>
            {emailSetting.enabled ? '关闭邮箱导入' : '开启邮箱导入'}
          </button>
          <button className="secondary-button" onClick={() => void updateEmailSetting(emailSetting.enabled, true)} disabled={settingBusy}>重新生成令牌</button>
        </div>
      </>}
    </section>

    {pendingImports.length > 0 && <section className="email-import-card">
      <div className="ai-card-title"><CheckCircle2 size={18} /><div><h2>待确认草稿</h2><span>来自邮箱的识别结果不会自动创建事项。</span></div></div>
      <div className="pending-imports">{pendingImports.map(item => <button key={item.id} type="button" onClick={() => { setRecord(item); setDraft(item.draft); }}>
        <strong>{item.draft.title}</strong><span>{item.draft.dueDate} · {item.draft.kind === 'recurring' ? '周期事务' : '待办日程'}</span><small>{new Date(item.expiresAt).toLocaleString('zh-CN')} 前有效</small>
      </button>)}</div>
    </section>}

    <section className="ai-import-card draft-card">
      <div className="ai-card-title"><CheckCircle2 size={18} /><div><h2>草稿确认</h2><span>{draft ? '请核对高亮字段后确认' : '检查邮箱后，识别草稿会显示在这里'}</span></div></div>
      {!draft ? <div className="ai-draft-empty"><Sparkles size={28} /><p>确认前不会创建事项。<br />识别完成后，你可以逐项修改。</p></div> : <>
        {draft.warnings.length > 0 && <div className="ai-warnings">{draft.warnings.map(item => <span key={item}><AlertTriangle size={13} />{item}</span>)}</div>}
        <div className="ai-draft-form">
          <label className={lowConfidence('title') ? 'low-confidence' : ''}>标题<input value={draft.title} onChange={event => update('title', event.target.value)} /></label>
          <label>创建为<select value={draft.kind} onChange={event => update('kind', event.target.value)}><option value="schedule">待办日程</option><option value="recurring">周期事务</option></select></label>
          <label className={lowConfidence('dueDate') ? 'low-confidence' : ''}>到期日期<input type="date" value={draft.dueDate} onChange={event => update('dueDate', event.target.value)} /></label>
          <label>时间<input type="time" value={draft.dueTime || ''} onChange={event => update('dueTime', event.target.value || null)} /></label>
          {draft.kind === 'recurring' && <><label>事务类型<select value={draft.templateKey} onChange={event => update('templateKey', event.target.value)}><option value="subscription">订阅续费</option><option value="insurance">保险</option><option value="document">证件</option><option value="membership">会员</option><option value="rent">房租</option><option value="utilities">水电账单</option><option value="vehicle_inspection">车辆年检</option><option value="custom">自定义</option></select></label><label>周期<select value={draft.recurrence.frequency} onChange={event => update('recurrence', { ...draft.recurrence, frequency: event.target.value })}><option value="once">单次</option><option value="monthly">每月</option><option value="yearly">每年</option><option value="interval">固定间隔</option></select></label></>}
          <label className="full">提醒提前天数<input value={draft.reminderOffsets.join(',')} onChange={event => update('reminderOffsets', event.target.value.split(/[,，\s]+/).map(Number).filter(Number.isFinite))} /></label>
          <label className="full">下一步操作<input value={draft.actionGuide} onChange={event => update('actionGuide', event.target.value)} /></label>
        </div>
        <div className="ai-draft-actions"><button className="secondary-button" onClick={() => void discard()}><Trash2 size={15} />丢弃草稿</button><button className="primary-button" onClick={() => void confirm()} disabled={busy}>{busy ? '正在创建…' : '确认并创建'}</button></div>
      </>}
    </section>
  </div>;
}
