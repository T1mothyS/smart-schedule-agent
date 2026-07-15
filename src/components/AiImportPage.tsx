import { ChangeEvent, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileImage, Mail, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface Draft {
  kind: 'schedule' | 'recurring';
  title: string;
  dueDate: string;
  dueTime: string | null;
  amountCents: number | null;
  currency: string;
  templateKey: string;
  recurrence: { frequency: string; interval: number; unit: string; advancePolicy: string };
  reminderOffsets: number[];
  actionGuide: string;
  notes: string;
  confidence: Record<string, number>;
  warnings: string[];
}

interface ImportRecord { id: string; status: string; draft: Draft; expiresAt: string }

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export function AiImportPage() {
  const { authHeaders } = useAuth();
  const [text, setText] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [emailSetting, setEmailSetting] = useState<{ enabled: boolean; importToken: string } | null>(null);
  const [pendingImports, setPendingImports] = useState<ImportRecord[]>([]);

  useEffect(() => {
    fetch('/api/email-import/settings', { headers: authHeaders() }).then(response => response.json()).then(data => setEmailSetting(data.setting)).catch(() => undefined);
    fetch('/api/ai/imports?status=draft', { headers: authHeaders() }).then(response => response.json()).then(data => setPendingImports(data.imports || [])).catch(() => undefined);
  }, [authHeaders]);

  const chooseImages = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []).filter(file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)).slice(0, 3);
    setImages(selected);
  };

  const parse = async () => {
    setBusy(true); setNotice(null);
    try {
      const encoded = await Promise.all(images.map(async file => ({ name: file.name, mimeType: file.type, base64: await fileToBase64(file) })));
      const response = await fetch('/api/ai/imports/parse', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, images: encoded }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '识别失败');
      setRecord(data.import); setDraft(data.import.draft);
      setPendingImports(current => [data.import, ...current.filter(item => item.id !== data.import.id)]);
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : '识别失败' }); }
    finally { setBusy(false); }
  };

  const update = (key: keyof Draft, value: any) => setDraft(current => current ? { ...current, [key]: value } : current);

  const confirm = async () => {
    if (!record || !draft) return;
    setBusy(true);
    try {
      const response = await fetch('/api/ai/imports/' + record.id + '/confirm', {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '确认失败');
      setNotice({ type: 'success', message: draft.kind === 'recurring' ? '周期事务已创建' : '待办日程已创建' });
      setPendingImports(current => current.filter(item => item.id !== record.id));
      setRecord(null); setDraft(null); setText(''); setImages([]);
    } catch (error) { setNotice({ type: 'error', message: error instanceof Error ? error.message : '确认失败' }); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    if (record) await fetch('/api/ai/imports/' + record.id, { method: 'DELETE', headers: authHeaders() });
    if (record) setPendingImports(current => current.filter(item => item.id !== record.id));
    setRecord(null); setDraft(null);
  };

  const updateEmailSetting = async (enabled: boolean, regenerate = false) => {
    const response = await fetch('/api/email-import/settings', {
      method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, regenerate }),
    });
    const data = await response.json();
    if (response.ok) setEmailSetting(data.setting);
  };

  const lowConfidence = (field: string) => (draft?.confidence?.[field] ?? 0) < .7;

  return <div className="ai-import-page">
    <header className="ai-import-header"><div><div className="eyebrow">AI INBOX</div><h1>智能导入</h1><p>从自然语言或账单截图提取日期、金额和周期；确认前不会写入正式日历。</p></div><WandSparkles size={34} /></header>
    {notice && <div className={'notice ' + notice.type}>{notice.type === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}{notice.message}</div>}
    <div className="ai-import-layout">
      <section className="ai-import-card">
        <div className="ai-card-title"><Sparkles size={18} /><div><h2>提供识别内容</h2><span>支持文字和最多 3 张账单截图</span></div></div>
        <textarea value={text} onChange={event => setText(event.target.value)} rows={7} placeholder="例如：我的车辆年检在 2027 年 4 月 18 日到期，提前 30 天和 7 天提醒我。&#10;也可以直接上传账单截图。" />
        <label className="ai-image-picker"><FileImage size={20} /><strong>选择账单截图</strong><span>JPEG / PNG / WebP，单张不超过 8MB</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={chooseImages} /></label>
        {images.length > 0 && <div className="selected-images">{images.map(file => <span key={file.name}>{file.name}</span>)}</div>}
        <button className="primary-button wide" onClick={parse} disabled={busy || (!text.trim() && images.length === 0)}>{busy ? '正在识别…' : '生成待确认草稿'}</button>
      </section>

      <section className="ai-import-card draft-card">
        <div className="ai-card-title"><CheckCircle2 size={18} /><div><h2>识别草稿</h2><span>{draft ? '请核对高亮字段后确认' : '识别结果会显示在这里'}</span></div></div>
        {!draft ? <div className="ai-draft-empty"><Sparkles size={28} /><p>AI 不会自动创建事项。<br />识别完成后，你可以逐项修改。</p></div> : <>
          {draft.warnings.length > 0 && <div className="ai-warnings">{draft.warnings.map(item => <span key={item}><AlertTriangle size={13} />{item}</span>)}</div>}
          <div className="ai-draft-form">
            <label className={lowConfidence('title') ? 'low-confidence' : ''}>标题<input value={draft.title} onChange={event => update('title', event.target.value)} /></label>
            <label>创建为<select value={draft.kind} onChange={event => update('kind', event.target.value)}><option value="schedule">待办日程</option><option value="recurring">周期事务</option></select></label>
            <label className={lowConfidence('dueDate') ? 'low-confidence' : ''}>到期日期<input type="date" value={draft.dueDate} onChange={event => update('dueDate', event.target.value)} /></label>
            <label>时间<input type="time" value={draft.dueTime || ''} onChange={event => update('dueTime', event.target.value || null)} /></label>
            <label className={lowConfidence('amountCents') ? 'low-confidence' : ''}>金额（CNY）<input type="number" step=".01" min="0" value={draft.amountCents === null ? '' : draft.amountCents / 100} onChange={event => update('amountCents', event.target.value ? Math.round(Number(event.target.value) * 100) : null)} /></label>
            {draft.kind === 'recurring' && <><label>事务类型<select value={draft.templateKey} onChange={event => update('templateKey', event.target.value)}><option value="subscription">订阅续费</option><option value="insurance">保险</option><option value="document">证件</option><option value="membership">会员</option><option value="rent">房租</option><option value="utilities">水电账单</option><option value="vehicle_inspection">车辆年检</option><option value="custom">自定义</option></select></label><label>周期<select value={draft.recurrence.frequency} onChange={event => update('recurrence', { ...draft.recurrence, frequency: event.target.value })}><option value="once">单次</option><option value="monthly">每月</option><option value="yearly">每年</option><option value="interval">固定间隔</option></select></label></>}
            <label className="full">提醒提前天数<input value={draft.reminderOffsets.join(',')} onChange={event => update('reminderOffsets', event.target.value.split(/[,，\s]+/).map(Number).filter(Number.isFinite))} /></label>
            <label className="full">下一步操作<input value={draft.actionGuide} onChange={event => update('actionGuide', event.target.value)} /></label>
          </div>
          <div className="ai-draft-actions"><button className="secondary-button" onClick={discard}><Trash2 size={15} /> 丢弃草稿</button><button className="primary-button" onClick={confirm} disabled={busy}>{busy ? '正在创建…' : '确认并创建'}</button></div>
        </>}
      </section>
    </div>

    {pendingImports.length > 0 && <section className="email-import-card"><div className="ai-card-title"><Sparkles size={18} /><div><h2>待确认草稿</h2><span>包含网页识别和邮箱自动生成的草稿</span></div></div><div className="pending-imports">{pendingImports.map(item => <button key={item.id} onClick={() => { setRecord(item); setDraft(item.draft); }}><strong>{item.draft.title}</strong><span>{item.draft.dueDate} · {item.draft.kind === 'recurring' ? '周期事务' : '待办日程'}</span><small>{new Date(item.expiresAt).toLocaleString('zh-CN')} 前有效</small></button>)}</div></section>}

    <section className="email-import-card"><div className="ai-card-title"><Mail size={18} /><div><h2>邮箱自动识别</h2><span>转发邮件只生成草稿，仍需登录确认</span></div></div>{emailSetting && <div className="email-import-setting"><div><span>主题导入令牌</span><code>[AI-IMPORT {emailSetting.importToken}]</code><small>把令牌放在转发邮件主题中。服务端未配置 IMAP 时不会读取邮箱。</small></div><div><button className={emailSetting.enabled ? 'secondary-button' : 'primary-button'} onClick={() => updateEmailSetting(!emailSetting.enabled)}>{emailSetting.enabled ? '关闭邮箱导入' : '开启邮箱导入'}</button><button className="secondary-button" onClick={() => updateEmailSetting(emailSetting.enabled, true)}>重新生成令牌</button></div></div>}</section>
  </div>;
}
