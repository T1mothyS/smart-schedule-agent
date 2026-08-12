import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CalendarClock, CheckCircle2, ChevronDown, Mail, Paperclip, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface ActionItem {
  id: string;
  sourceType: 'schedule' | 'reminder';
  sourceId: string;
  instanceId: string | null;
  title: string;
  dueAt: string;
  allDay: boolean;
  status: 'upcoming' | 'today' | 'overdue' | 'completed';
  priority: 'high' | 'medium' | 'low';
  nextAction: string;
  itemType: 'event' | 'todo' | 'recurring';
  isUnscheduled?: boolean;
  completionId: string | null;
  proof: {
    note: string | null;
    billDate: string | null;
    attachments: Array<{ id: string; originalName: string; mimeType: string; sizeBytes: number }>;
  } | null;
}

interface ActionCenterData {
  next: ActionItem | null;
  today: ActionItem[];
  upcoming: ActionItem[];
  overdue: ActionItem[];
  unscheduled: ActionItem[];
  completedToday: ActionItem[];
  upcomingDays: number;
}

interface NotificationItem {
  id: string;
  channel: 'email' | 'in_app' | 'browser';
  title: string;
  body: string;
  status: string;
  readAt: string | null;
  createdAt: string;
}

const emptyData: ActionCenterData = { next: null, today: [], upcoming: [], overdue: [], unscheduled: [], completedToday: [], upcomingDays: 7 };

function formatDate(value: string, allDay = false): string {
  if (allDay) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${Number(match[2])}月${Number(match[3])}日 全天`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function actionDetails(item: ActionItem): string {
  return [formatDate(item.dueAt, item.allDay), item.nextAction].filter(Boolean).join(' · ');
}

function ActionList({ title, hint, items, tone, onComplete }: {
  title: string;
  hint: string;
  items: ActionItem[];
  tone: 'normal' | 'warning' | 'danger';
  onComplete: (item: ActionItem) => void;
}) {
  return <section className={'action-section ' + tone}>
    <div className="action-section-head"><div><h2>{title}</h2><span>{hint}</span></div><strong>{items.length}</strong></div>
    {items.length === 0 ? <div className="action-empty">这里暂时没有事项</div> : <div className="action-list">
      {items.map(item => <article key={item.id} className="action-row">
        <div className={'priority-dot ' + item.priority} />
        <div className="action-row-main"><div className="action-row-title">{item.title}</div><div className="action-row-meta"><span>{item.itemType === 'recurring' ? '周期事务' : item.itemType === 'todo' ? '待办' : '日程'}</span><span>{formatDate(item.dueAt, item.allDay)}</span>{item.nextAction && <span>{item.nextAction}</span>}</div></div>
        <button className="complete-button" onClick={() => onComplete(item)}><CheckCircle2 size={15} /> 完成</button>
      </article>)}
    </div>}
  </section>;
}

function SuspendedTodoSection({ items, title, onTitleChange, onCreate, onComplete, onDelete, saving, deletingId }: {
  items: ActionItem[];
  title: string;
  onTitleChange: (value: string) => void;
  onCreate: () => void;
  onComplete: (item: ActionItem) => void;
  onDelete: (item: ActionItem) => void;
  saving: boolean;
  deletingId: string | null;
}) {
  return <section id="suspended-todos" className="action-section suspended-todo-section">
    <div className="suspended-todo-head">
      <div className="suspended-todo-title">
        <div className="suspended-todo-icon"><CalendarClock size={19} /></div>
        <div><h2>挂起待办（无固定期限）</h2><span>没有具体执行日期，完成前会一直保留在这里</span></div>
      </div>
      <strong>{items.length}</strong>
    </div>
    <form className="suspended-todo-form" onSubmit={event => { event.preventDefault(); onCreate(); }}>
      <input
        aria-label="新增无固定期限待办"
        value={title}
        onChange={event => onTitleChange(event.target.value)}
        placeholder="添加一个无固定期限的挂起待办…"
        maxLength={160}
      />
      <button className="secondary-button" type="submit" disabled={saving || !title.trim()}><Plus size={15} /> 添加待办</button>
    </form>
    {items.length === 0 ? <div className="suspended-todo-empty">暂无挂起待办，也可以在创建普通待办时勾选“无固定期限待办”。</div> : <div className="action-list">
      {items.map(item => <article key={item.id} className="action-row suspended-todo-row">
        <div className={'priority-dot ' + item.priority} />
        <div className="action-row-main"><div className="action-row-title">{item.title}</div><div className="action-row-meta"><span>无固定期限待办</span>{item.nextAction && <span>{item.nextAction}</span>}</div></div>
        <div className="suspended-todo-actions">
          <button className="complete-button" onClick={() => onComplete(item)}><CheckCircle2 size={15} /> 完成</button>
          <button className="icon-button suspended-todo-delete" type="button" onClick={() => onDelete(item)} disabled={deletingId === item.sourceId} aria-label={`删除无固定期限待办 ${item.title}`} title="删除"><Trash2 size={15} /></button>
        </div>
      </article>)}
    </div>}
  </section>;
}

export function ActionCenterPage() {
  const { authHeaders } = useAuth();
  const [data, setData] = useState<ActionCenterData>(emptyData);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<ActionItem | null>(null);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [suspendedTitle, setSuspendedTitle] = useState('');
  const [savingSuspended, setSavingSuspended] = useState(false);
  const [deletingSuspendedId, setDeletingSuspendedId] = useState<string | null>(null);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendNotice, setSendNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const unread = useMemo(() => notifications.filter(item => !item.readAt).length, [notifications]);

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/action-center?upcomingDays=' + days, { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '加载失败');
      setData({ ...emptyData, ...result });
    } finally { setLoading(false); }
  }, [authHeaders, days]);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications?limit=30', { headers: authHeaders() });
      if (!response.ok) return;
      const result = await response.json();
      const list: NotificationItem[] = result.notifications || [];
      setNotifications(list);
      if ('Notification' in window && Notification.permission === 'granted') {
        for (const item of list.filter(entry => entry.channel === 'browser' && entry.status === 'sent' && !entry.readAt).slice(0, 3)) {
          new Notification(item.title, { body: item.body, tag: item.id });
          fetch('/api/notifications/' + item.id + '/read', { method: 'POST', headers: authHeaders() }).catch(() => undefined);
        }
      }
    } catch { /* 站内通知失败不影响行动中心 */ }
  }, [authHeaders]);

  useEffect(() => { loadActions(); }, [loadActions]);
  useEffect(() => {
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files || []).slice(0, 5));
  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const sendTodayEmail = async () => {
    if (sendingEmail) return;
    setSendingEmail(true);
    setSendNotice(null);
    try {
      const response = await fetch('/api/action-center/send-email', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '邮件发送失败');
      setShowSendDialog(false);
      setSendNotice({ tone: 'success', text: result.message || '今天的安排已发送。' });
    } catch (error) {
      setSendNotice({ tone: 'error', text: error instanceof Error ? error.message : '邮件发送失败，请稍后重试。' });
    } finally { setSendingEmail(false); }
  };

  const createSuspendedTodo = async () => {
    const title = suspendedTitle.trim();
    if (!title || savingSuspended) return;
    setSavingSuspended(true);
    try {
      const response = await fetch('/api/suspended-todos', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '添加挂起待办失败');
      setSuspendedTitle('');
      await loadActions();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '添加挂起待办失败');
    } finally { setSavingSuspended(false); }
  };

  const deleteSuspendedTodo = async (item: ActionItem) => {
    if (deletingSuspendedId || !window.confirm(`确定删除“${item.title}”吗？`)) return;
    setDeletingSuspendedId(item.sourceId);
    try {
      const response = await fetch('/api/suspended-todos/' + item.sourceId, { method: 'DELETE', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '删除挂起待办失败');
      await loadActions();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除挂起待办失败');
    } finally { setDeletingSuspendedId(null); }
  };

  const complete = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const response = await fetch('/api/completions', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: target.sourceType,
          sourceId: target.sourceId,
          instanceId: target.instanceId,
          note,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '登记完成失败');
      if (files.length) {
        const encoded = await Promise.all(files.map(async file => ({ name: file.name, mimeType: file.type, base64: await fileToBase64(file) })));
        const upload = await fetch('/api/completions/' + result.completion.id + '/attachments', {
          method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ files: encoded }),
        });
        if (!upload.ok) { const error = await upload.json(); throw new Error(error.error || '完成已登记，但附件上传失败'); }
      }
      setTarget(null); setNote(''); setFiles([]);
      await loadActions();
    } catch (error) { window.alert(error instanceof Error ? error.message : '登记完成失败'); }
    finally { setSaving(false); }
  };

  const markNotificationRead = async (item: NotificationItem) => {
    if (!item.readAt) await fetch('/api/notifications/' + item.id + '/read', { method: 'POST', headers: authHeaders() });
    setNotifications(current => current.map(entry => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
  };

  const openAttachment = async (attachment: { id: string; originalName: string }) => {
    const response = await fetch('/api/attachments/' + attachment.id, { headers: authHeaders() });
    if (!response.ok) return window.alert('附件读取失败');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = attachment.originalName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div className="action-center-page">
    <header className="action-center-header">
      <div><div className="eyebrow">TODAY COMMAND CENTER</div><h1>今日行动中心</h1></div>
      <div className="action-header-tools">
        <button className="secondary-button send-schedule-button" onClick={() => { setSendNotice(null); setShowSendDialog(true); }}><Mail size={15} /> 一键发送日程</button>
        <button className="icon-button notification-button" onClick={() => setShowNotifications(value => !value)} title="通知中心"><Bell size={17} />{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}</button>
        <button className="secondary-button" onClick={loadActions}><RefreshCw size={15} /> 刷新</button>
      </div>
      {showNotifications && <div className="notification-popover"><div className="notification-popover-head"><strong>通知中心</strong><span>{unread} 条未读</span></div>{notifications.length === 0 ? <div className="action-empty">暂无通知</div> : notifications.map(item => <button key={item.id} className={!item.readAt ? 'notification-entry unread' : 'notification-entry'} onClick={() => markNotificationRead(item)}><strong>{item.title}</strong><span>{item.body}</span><small>{formatDate(item.createdAt)} · {item.channel}</small></button>)}</div>}
    </header>

    {sendNotice && <div className={'action-inline-notice ' + sendNotice.tone}>{sendNotice.text}</div>}

    {data.next && <section className="next-action-card"><div className="next-action-icon"><Sparkles size={22} /></div><div><span>下一步该做什么</span><h2>{data.next.title}</h2><p>{actionDetails(data.next)}</p></div><button className="primary-button" onClick={() => setTarget(data.next!)}>现在处理</button></section>}

    {loading ? <div className="empty-panel"><div className="loading-dot" />正在整理今天的行动</div> : <>
      <SuspendedTodoSection
        items={data.unscheduled}
        title={suspendedTitle}
        onTitleChange={setSuspendedTitle}
        onCreate={createSuspendedTodo}
        onComplete={setTarget}
        onDelete={deleteSuspendedTodo}
        saving={savingSuspended}
        deletingId={deletingSuspendedId}
      />
      <ActionList title="今天" hint="今天需要到场或完成的事项" items={data.today} tone="normal" onComplete={setTarget} />
      <div className="action-section-head standalone"><div><h2>即将到期</h2><span>提前留出准备时间</span></div><select value={days} onChange={event => setDays(Number(event.target.value))}><option value={3}>未来 3 天</option><option value={7}>未来 7 天</option><option value={14}>未来 14 天</option></select></div>
      <ActionList title="" hint="" items={data.upcoming} tone="warning" onComplete={setTarget} />
      <ActionList title="已经逾期" hint="逾期周期仍可手动完成，不会消失" items={data.overdue} tone="danger" onComplete={setTarget} />
      <section className="completed-section"><button onClick={() => setShowCompleted(value => !value)}><CheckCircle2 size={17} /> 今天已完成 {data.completedToday.length} 项 <ChevronDown size={15} className={showCompleted ? 'rotated' : ''} /></button>{showCompleted && <div className="action-list">{data.completedToday.map(item => <div className="action-row completed" key={item.id}><CheckCircle2 size={16} /><div className="action-row-main"><div className="action-row-title">{item.title}</div><div className="action-row-meta">{item.nextAction && <span>{item.nextAction}</span>}{item.proof?.note && <span>备注：{item.proof.note}</span>}</div>{item.proof?.attachments.length ? <div className="proof-files">{item.proof.attachments.map(file => <button key={file.id} onClick={() => openAttachment(file)}><Paperclip size={13} />{file.originalName}</button>)}</div> : null}</div></div>)}</div>}</section>
    </>}

    {showSendDialog && <div className="modal-backdrop" onMouseDown={() => { if (!sendingEmail) setShowSendDialog(false); }}><div className="complete-modal send-schedule-modal" onMouseDown={event => event.stopPropagation()}><button className="icon-button modal-close" onClick={() => setShowSendDialog(false)} disabled={sendingEmail}><X size={16} /></button><div className="send-schedule-icon"><Mail size={23} /></div><h2>发送今天的日程？</h2><p>确认后会立即把今天的日程和今天的待办发送到你绑定的通知邮箱。</p><div className="modal-foot"><button className="secondary-button" onClick={() => setShowSendDialog(false)} disabled={sendingEmail}>取消</button><button className="primary-button" onClick={sendTodayEmail} disabled={sendingEmail}>{sendingEmail ? '发送中…' : '确认发送'}</button></div></div></div>}

    {target && <div className="modal-backdrop" onMouseDown={() => setTarget(null)}><div className="complete-modal" onMouseDown={event => event.stopPropagation()}><button className="icon-button modal-close" onClick={() => setTarget(null)}><X size={16} /></button><div className="complete-icon"><CheckCircle2 size={24} /></div><h2>完成“{target.title}”</h2><p>完成后仍可从历史中重新打开，不会丢失证明。</p><label className="form-label">备注<textarea rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="记录处理结果、金额、账单编号或注意事项" /></label><label className="form-label attachment-picker"><Paperclip size={15} /> 上传证明（最多 5 个，每个 10MB）<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={chooseFiles} /><small>{files.length ? files.map(file => file.name).join('、') : '支持图片和 PDF'}</small></label><div className="modal-foot"><button className="secondary-button" onClick={() => setTarget(null)}>取消</button><button className="primary-button" onClick={complete} disabled={saving}>{saving ? '保存中…' : '确认完成'}</button></div></div></div>}
  </div>;
}
