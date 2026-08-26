import { KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, CheckCircle2, ChevronDown, Edit3, Mail, MoreHorizontal, Paperclip, RefreshCw, Trash2, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Schedule, ScheduleDetailModal, ScheduleFormModal } from './CalendarView';
import { useNavigate } from 'react-router-dom';

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
  isUnscheduled: boolean;
  completedAt: string | null;
  completionId: string | null;
  proof: {
    note: string | null;
    amountCents: number | null;
    currency: string;
    billDate: string | null;
    attachments: Array<{ id: string; originalName: string; mimeType: string; sizeBytes: number }>;
  } | null;
}

interface ActionCenterData {
  next: ActionItem | null;
  today: ActionItem[];
  tomorrow: ActionItem[];
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

const emptyData: ActionCenterData = { next: null, today: [], tomorrow: [], upcoming: [], overdue: [], unscheduled: [], completedToday: [], upcomingDays: 7 };

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`无法读取附件：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function formatDate(value: string, allDay = false): string {
  if (allDay) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${Number(match[2])}月${Number(match[3])}日 全天`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

type ActionMenuAction = 'edit' | 'delete' | 'defer-one-day' | 'convert-to-unscheduled';

function ActionItemMenu({ item, open, onToggle, onAction }: {
  item: ActionItem;
  open: boolean;
  onToggle: () => void;
  onAction: (action: ActionMenuAction) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [menuReady, setMenuReady] = useState(false);
  const entries: Array<{ action: ActionMenuAction; label: string; icon?: typeof Edit3; danger?: boolean }> = [
    { action: 'edit', label: '编辑', icon: Edit3 },
    ...(item.sourceType === 'schedule' && !item.isUnscheduled && item.status !== 'completed'
      ? [{ action: 'defer-one-day' as const, label: '顺延一天' }]
      : []),
    ...(item.sourceType === 'schedule' && !item.isUnscheduled && item.status !== 'completed' && item.itemType !== 'recurring'
      ? [{ action: 'convert-to-unscheduled' as const, label: '转为无固定期限' }]
      : []),
    { action: 'delete', label: '删除', icon: Trash2, danger: true },
  ];

  useLayoutEffect(() => {
    if (!open) {
      setMenuReady(false);
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const gap = 6;
    const left = Math.max(8, Math.min(
      triggerRect.right - menuRect.width,
      window.innerWidth - menuRect.width - 8,
    ));
    const belowTop = triggerRect.bottom + gap;
    const top = belowTop + menuRect.height <= window.innerHeight - 8
      ? belowTop
      : Math.max(8, triggerRect.top - menuRect.height - gap);

    setMenuPosition({ left, top });
    setMenuReady(true);
  }, [entries.length, open]);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus({ preventScroll: true });
    const scrollGuardUntil = Date.now() + 250;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) onToggle();
    };
    const closeOnUserScroll = () => {
      if (Date.now() >= scrollGuardUntil) onToggle();
    };
    const closeOnKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onToggle();
    };
    document.addEventListener('pointerdown', closeOnOutside);
    window.addEventListener('wheel', closeOnUserScroll, { capture: true, passive: true });
    window.addEventListener('touchmove', closeOnUserScroll, { capture: true, passive: true });
    document.addEventListener('keydown', closeOnKey);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      window.removeEventListener('wheel', closeOnUserScroll, true);
      window.removeEventListener('touchmove', closeOnUserScroll, true);
      document.removeEventListener('keydown', closeOnKey);
    };
  }, [onToggle, open]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (open && event.key === 'Escape') {
      event.preventDefault();
      onToggle();
      return;
    }
    if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (currentIndex + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[nextIndex]?.focus({ preventScroll: true });
  };

  return <>
    <div
      className="action-row-menu"
      onClick={event => event.stopPropagation()}
      onKeyDown={handleMenuKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="icon-button action-menu-trigger"
        aria-label={`打开 ${item.title} 的更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={event => { event.stopPropagation(); onToggle(); }}
      ><MoreHorizontal size={17} /></button>
    </div>
    {open && typeof document !== 'undefined' && createPortal(
      <div
        ref={menuRef}
        className="action-menu-popover"
        role="menu"
        style={{ left: menuPosition.left, top: menuPosition.top, visibility: menuReady ? 'visible' : 'hidden' }}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onKeyDown={handleMenuKeyDown}
      >
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          return <button
            key={entry.action}
            ref={index === 0 ? firstItemRef : undefined}
            type="button"
            role="menuitem"
            className={entry.danger ? 'danger' : ''}
            onClick={event => { event.stopPropagation(); onAction(entry.action); }}
          >{Icon && <Icon size={14} />}<span>{entry.label}</span></button>;
        })}
      </div>,
      document.body,
    )}
  </>;
}

function ActionList({ title, hint, items, tone, menuScope, headerControl, onComplete, onEdit, onMenuAction, openMenuId, setOpenMenuId, completingId }: {
  title: string;
  hint: string;
  items: ActionItem[];
  tone: 'normal' | 'warning' | 'danger';
  menuScope: string;
  headerControl?: ReactNode;
  onComplete: (item: ActionItem) => void;
  onEdit: (item: ActionItem) => void;
  onMenuAction: (item: ActionItem, action: ActionMenuAction) => void;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  completingId: string | null;
}) {
  return <section className={'action-section ' + tone}>
    <div className="action-section-head"><div><h2>{title}</h2>{hint && <span>{hint}</span>}</div><div className="action-section-head-tools">{headerControl}<strong>{items.length}</strong></div></div>
    {items.length === 0 ? <div className="action-empty">这里暂时没有事项</div> : <div className="action-list">
      {items.map(item => {
        const menuId = menuScope + ':' + item.id;
        return <article
        key={item.id}
        className={item.sourceType === 'schedule' ? 'action-row editable' : 'action-row'}
        onClick={() => item.sourceType === 'schedule' && onEdit(item)}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (item.sourceType === 'schedule' && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onEdit(item);
          }
        }}
        tabIndex={item.sourceType === 'schedule' ? 0 : undefined}
        role={item.sourceType === 'schedule' ? 'button' : undefined}
        aria-label={item.sourceType === 'schedule' ? `编辑日程：${item.title}` : undefined}
      >
        {item.itemType === 'recurring' ? <div className="recurring-priority" title="周期事务" aria-label="周期事务"><RefreshCw size={22} strokeWidth={1.8} aria-hidden="true" /><span className={'priority-dot ' + item.priority} /></div> : <div className={'priority-dot ' + item.priority} />}
        <div className="action-row-main"><div className="action-row-title">{item.title}</div><div className="action-row-meta"><span>{item.itemType === 'recurring' ? '周期事务' : item.itemType === 'todo' ? '待办' : '日程'}</span><span>{formatDate(item.dueAt, item.allDay)}</span>{item.nextAction && <span>{item.nextAction}</span>}</div></div>
        <div className="action-row-actions">
          <button
            type="button"
            className="complete-button"
            onClick={event => { event.stopPropagation(); onComplete(item); }}
            disabled={completingId === item.id}
          ><CheckCircle2 size={15} /> {completingId === item.id ? '完成中…' : '完成'}</button>
          <ActionItemMenu item={item} open={openMenuId === menuId} onToggle={() => setOpenMenuId(openMenuId === menuId ? null : menuId)} onAction={action => { setOpenMenuId(null); onMenuAction(item, action); }} />
        </div>
      </article>;
      })}
    </div>}
  </section>;
}

function SuspendedTodoSection({ items, onComplete, onEdit, onMenuAction, openMenuId, setOpenMenuId, completingId }: {
  items: ActionItem[];
  onComplete: (item: ActionItem) => void;
  onEdit: (item: ActionItem) => void;
  onMenuAction: (item: ActionItem, action: ActionMenuAction) => void;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  completingId: string | null;
}) {
  return <section id="suspended-todos" className="action-section suspended-todo-section">
    <div className="suspended-todo-head">
      <div className="suspended-todo-title">
        <div className="suspended-todo-icon"><CalendarClock size={19} /></div>
        <div><h2>挂起待办</h2><span>没有具体执行日期，完成前会一直保留在这里</span></div>
      </div>
      <strong>{items.length}</strong>
    </div>
    {items.length === 0 ? <div className="suspended-todo-empty">暂无无固定期限待办</div> : <div className="action-list">
      {items.map(item => {
        const menuId = 'suspended:' + item.id;
        return <article
        key={item.id}
        className="action-row suspended-todo-row editable"
        onClick={() => onEdit(item)}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onEdit(item);
          }
        }}
        tabIndex={0}
        role="button"
        aria-label={`编辑待办：${item.title}`}
      >
        <div className={'priority-dot ' + item.priority} />
        <div className="action-row-main"><div className="action-row-title">{item.title}</div><div className="action-row-meta"><span>无固定期限待办</span>{item.nextAction && <span>{item.nextAction}</span>}</div></div>
        <div className="suspended-todo-actions">
          <button className="complete-button" type="button" onClick={event => { event.stopPropagation(); onComplete(item); }} disabled={completingId === item.id}><CheckCircle2 size={15} /> {completingId === item.id ? '完成中…' : '完成'}</button>
          <ActionItemMenu item={item} open={openMenuId === menuId} onToggle={() => setOpenMenuId(openMenuId === menuId ? null : menuId)} onAction={action => { setOpenMenuId(null); onMenuAction(item, action); }} />
        </div>
      </article>;
      })}
    </div>}
  </section>;
}

export function ActionCenterPage() {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<ActionCenterData>(emptyData);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [detailSchedule, setDetailSchedule] = useState<Schedule | null>(null);
  const [completedDetail, setCompletedDetail] = useState<ActionItem | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendNotice, setSendNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [completionEditTarget, setCompletionEditTarget] = useState<ActionItem | null>(null);
  const [completionExistingFiles, setCompletionExistingFiles] = useState<NonNullable<ActionItem['proof']>['attachments']>([]);
  const [completionRemovedFileIds, setCompletionRemovedFileIds] = useState<string[]>([]);
  const [completionNote, setCompletionNote] = useState('');
  const [completionAmount, setCompletionAmount] = useState('');
  const [completionBillDate, setCompletionBillDate] = useState('');
  const [completionFiles, setCompletionFiles] = useState<File[]>([]);

  const loadActions = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch('/api/action-center?upcomingDays=' + days, { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '加载失败');
      setData({ ...emptyData, ...result });
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [authHeaders, days]);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications?limit=30', { headers: authHeaders() });
      if (!response.ok) return;
      const result = await response.json();
      const list: NotificationItem[] = result.notifications || [];
      if ('Notification' in window && Notification.permission === 'granted') {
        for (const item of list.filter(entry => entry.channel === 'browser' && entry.status === 'sent' && !entry.readAt).slice(0, 3)) {
          new Notification(item.title, { body: item.body, tag: item.id });
          fetch('/api/notifications/' + item.id + '/read', { method: 'POST', headers: authHeaders() }).catch(() => undefined);
        }
      }
    } catch { /* 浏览器通知失败不影响行动中心 */ }
  }, [authHeaders]);

  useEffect(() => { loadActions(); }, [loadActions]);
  useEffect(() => {
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

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

  const complete = async (item: ActionItem) => {
    if (completingId) return;
    setCompletingId(item.id);
    try {
      const response = await fetch('/api/completions', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          instanceId: item.instanceId,
          note: null,
          amountCents: null,
          currency: 'CNY',
          billDate: null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.completion) throw new Error(result.error || '登记完成失败');
      await loadActions(false);
    } catch (error) { window.alert(error instanceof Error ? error.message : '登记完成失败'); }
    finally { setCompletingId(null); }
  };

  const openCompletionEditor = (item: ActionItem) => {
    if (!item.completionId) return window.alert('当前事项没有可编辑的完成记录，请先重新完成一次。');
    setCompletionEditTarget(item);
    setCompletionExistingFiles(item.proof?.attachments || []);
    setCompletionRemovedFileIds([]);
    setCompletionNote(item.proof?.note || '');
    setCompletionAmount(item.proof?.amountCents == null ? '' : (item.proof.amountCents / 100).toFixed(2));
    setCompletionBillDate(item.proof?.billDate || '');
    setCompletionFiles([]);
  };

  const saveCompletionEdit = async () => {
    const item = completionEditTarget;
    if (!item?.completionId || completingId) return;
    const amount = completionAmount.trim();
    if (amount && (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) > 100_000_000)) {
      return window.alert('金额应为非负数字，最多保留两位小数');
    }
    if (completionExistingFiles.length + completionFiles.length > 5 || completionFiles.some(file => file.size > 10 * 1024 * 1024)) {
      return window.alert('完成证明最多保留 5 个附件，每个附件不能超过 10MB');
    }
    setCompletingId(item.id);
    try {
      const response = await fetch('/api/completions/' + item.completionId, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: completionNote.trim() || null,
          amountCents: amount ? Math.round(Number(amount) * 100) : null,
          currency: 'CNY',
          billDate: completionBillDate || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.completion) throw new Error(result.error || '保存完成记录失败');

      if (completionFiles.length) {
        const files = await Promise.all(completionFiles.map(async file => ({
          name: file.name,
          mimeType: file.type,
          base64: await fileAsBase64(file),
        })));
        const upload = await fetch(`/api/completions/${item.completionId}/attachments`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ files }),
        });
        const uploadResult = await upload.json();
        if (!upload.ok) throw new Error(uploadResult.error || '上传附件失败');
      }

      for (const attachmentId of completionRemovedFileIds) {
        const remove = await fetch('/api/attachments/' + attachmentId, { method: 'DELETE', headers: authHeaders() });
        if (!remove.ok) {
          const removeResult = await remove.json().catch(() => ({}));
          throw new Error(removeResult.error || '删除旧附件失败');
        }
      }
      setCompletionEditTarget(null);
      setCompletedDetail(null);
      setDetailSchedule(null);
      await loadActions(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存完成记录失败');
    } finally { setCompletingId(null); }
  };

  const openScheduleEditor = async (item: ActionItem) => {
    if (item.sourceType !== 'schedule') return;
    try {
      const response = await fetch('/api/schedules/' + item.sourceId, { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok || !result.schedule) throw new Error(result.error || '读取日程失败');
      setEditingSchedule(result.schedule as Schedule);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '读取日程失败');
    }
  };

  const handleMenuAction = async (item: ActionItem, action: ActionMenuAction) => {
    if (action === 'edit') {
      if (item.sourceType === 'schedule') await openScheduleEditor(item);
      else navigate('/reminders?edit=' + encodeURIComponent(item.sourceId));
      return;
    }
    if (action === 'delete') {
      if (!window.confirm(`确定删除“${item.title}”吗？删除后无法从行动中心恢复。`)) return;
      const endpoint = item.sourceType === 'schedule'
        ? '/api/schedules/' + item.sourceId
        : '/api/cycle-reminders/' + item.sourceId;
      try {
        const response = await fetch(endpoint, { method: 'DELETE', headers: authHeaders() });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '删除失败');
        await loadActions(false);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '删除失败');
      }
      return;
    }
    if (item.sourceType !== 'schedule') return;
    if (action === 'convert-to-unscheduled' && !window.confirm(`将“${item.title}”转为无固定期限待办？原日期会被清除。`)) return;
    try {
      const response = await fetch('/api/schedules/' + item.sourceId + '/actions', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '操作失败');
      await loadActions(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '操作失败');
    }
  };

  const openCompletedDetails = async (item: ActionItem) => {
    if (item.sourceType !== 'schedule') {
      setCompletedDetail(item);
      return;
    }
    try {
      const response = await fetch('/api/schedules/' + item.sourceId, { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok || !result.schedule) throw new Error(result.error || '读取日程详情失败');
      setCompletedDetail(item);
      setDetailSchedule(result.schedule as Schedule);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '读取日程详情失败');
    }
  };

  const reopenCompleted = async (item: ActionItem) => {
    if (reopeningId) return;
    setReopeningId(item.id);
    try {
      const response = item.completionId
        ? await fetch('/api/completions/' + item.completionId + '/reopen', {
          method: 'POST',
          headers: authHeaders(),
        })
        : item.sourceType === 'schedule'
        ? await fetch('/api/schedules/' + item.sourceId + '/toggle', {
          method: 'POST',
          headers: authHeaders(),
        })
        : null;
      if (!response) throw new Error('当前完成记录无法恢复为未完成');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '设为未完成失败');
      setCompletedDetail(null);
      setDetailSchedule(null);
      await loadActions(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '设为未完成失败');
    } finally {
      setReopeningId(null);
    }
  };

  const deleteScheduleFromDetails = async (id: string) => {
    try {
      const response = await fetch('/api/schedules/' + id, { method: 'DELETE', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '删除日程失败');
      setDetailSchedule(null);
      setCompletedDetail(null);
      await loadActions(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除日程失败');
    }
  };

  const toggleScheduleFromDetails = async (id: string) => {
    try {
      const response = await fetch('/api/schedules/' + id + '/toggle', { method: 'POST', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok || !result.schedule) throw new Error(result.error || '更新完成状态失败');
      setDetailSchedule(null);
      setCompletedDetail(null);
      await loadActions(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '更新完成状态失败');
    }
  };

  const saveScheduleEdit = async (form: Partial<Schedule>) => {
    if (!editingSchedule) return;
    try {
      const response = await fetch('/api/schedules/' + editingSchedule.id, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok || !result.schedule) throw new Error(result.error || '保存日程失败');
      setEditingSchedule(null);
      await loadActions(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存日程失败');
    }
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
        <button className="secondary-button" onClick={() => loadActions()}><RefreshCw size={15} /> 刷新</button>
      </div>
    </header>

    {sendNotice && <div className={'action-inline-notice ' + sendNotice.tone}>{sendNotice.text}</div>}

    {loading ? <div className="empty-panel"><div className="loading-dot" />正在整理今天的行动</div> : <>
      <SuspendedTodoSection items={data.unscheduled} onComplete={complete} onEdit={openScheduleEditor} onMenuAction={handleMenuAction} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} completingId={completingId} />
      <ActionList title="今天" hint="" items={data.today} tone="normal" menuScope="today" onComplete={complete} onEdit={openScheduleEditor} onMenuAction={handleMenuAction} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} completingId={completingId} />
      <ActionList title="明天" hint="" items={data.tomorrow} tone="normal" menuScope="tomorrow" onComplete={complete} onEdit={openScheduleEditor} onMenuAction={handleMenuAction} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} completingId={completingId} />
      <ActionList title="即将到期" hint="" items={data.upcoming} tone="warning" menuScope="upcoming" headerControl={<select aria-label="即将到期筛选范围" value={days} onChange={event => setDays(Number(event.target.value))}><option value={3}>未来 3 天</option><option value={7}>未来 7 天</option><option value={14}>未来 14 天</option></select>} onComplete={complete} onEdit={openScheduleEditor} onMenuAction={handleMenuAction} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} completingId={completingId} />
      <ActionList title="已经逾期" hint="逾期周期仍可手动完成，不会消失" items={data.overdue} tone="danger" menuScope="overdue" onComplete={complete} onEdit={openScheduleEditor} onMenuAction={handleMenuAction} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} completingId={completingId} />
      <section className="completed-section">
        <button type="button" onClick={() => setShowCompleted(value => !value)}>
          <CheckCircle2 size={17} /> 今天已完成 {data.completedToday.length} 项 <ChevronDown size={15} className={showCompleted ? 'rotated' : ''} />
        </button>
        {showCompleted && <div className="action-list">
          {data.completedToday.map(item => <article
            className="action-row completed editable"
            key={item.id}
            onClick={() => openCompletedDetails(item)}
            onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openCompletedDetails(item);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`查看已完成事项：${item.title}`}
          >
            <CheckCircle2 size={16} />
            <div className="action-row-main">
              <div className="action-row-title">{item.title}</div>
              <div className="action-row-meta">
                <span>{item.itemType === 'recurring' ? '周期事务' : item.itemType === 'todo' ? '待办' : '日程'}</span>
                <span>{formatDate(item.dueAt, item.allDay)}</span>
                {item.completedAt && <span>完成于 {formatDate(item.completedAt)}</span>}
                {item.nextAction && <span>{item.nextAction}</span>}
                {item.proof?.note && <span>备注：{item.proof.note}</span>}
                {item.proof?.amountCents != null && <span>金额：{(item.proof.amountCents / 100).toFixed(2)} {item.proof.currency}</span>}
                {item.proof?.billDate && <span>账单日：{item.proof.billDate}</span>}
              </div>
              {item.proof?.attachments.length ? <div className="proof-files">{item.proof.attachments.map(file => <button key={file.id} onClick={event => { event.stopPropagation(); openAttachment(file); }}><Paperclip size={13} />{file.originalName}</button>)}</div> : null}
            </div>
            <div className="completed-row-actions">
              <button type="button" className="secondary-button completed-detail-button" onClick={event => { event.stopPropagation(); openCompletedDetails(item); }}>详情</button>
              <button type="button" className="complete-button completed-reopen-button" onClick={event => { event.stopPropagation(); reopenCompleted(item); }} disabled={reopeningId === item.id || (!item.completionId && item.sourceType !== 'schedule')}>
                {reopeningId === item.id ? '处理中…' : '设为未完成'}
              </button>
            </div>
          </article>)}
        </div>}
      </section>
    </>}

    {showSendDialog && <div className="modal-backdrop" onMouseDown={() => { if (!sendingEmail) setShowSendDialog(false); }}><div className="complete-modal send-schedule-modal" onMouseDown={event => event.stopPropagation()}><button className="icon-button modal-close" onClick={() => setShowSendDialog(false)} disabled={sendingEmail}><X size={16} /></button><div className="send-schedule-icon"><Mail size={23} /></div><h2>发送今天的日程？</h2><p>确认后会立即把今天的日程和今天的待办发送到你绑定的通知邮箱。</p><div className="modal-foot"><button className="secondary-button" onClick={() => setShowSendDialog(false)} disabled={sendingEmail}>取消</button><button className="primary-button" onClick={sendTodayEmail} disabled={sendingEmail}>{sendingEmail ? '发送中…' : '确认发送'}</button></div></div></div>}

    {completionEditTarget && <div className="modal-backdrop" onMouseDown={() => { if (!completingId) setCompletionEditTarget(null); }}>
      <div className="complete-modal completion-proof-modal" onMouseDown={event => event.stopPropagation()}>
        <button type="button" className="icon-button modal-close" onClick={() => setCompletionEditTarget(null)} disabled={!!completingId} aria-label="关闭"><X size={16} /></button>
        <div className="complete-icon"><Edit3 size={24} /></div>
        <h2>编辑“{completionEditTarget.title}”的完成记录</h2>
        <p>完成记录已保存；可补充或修改备注、金额、账单日期和证明附件。</p>
        <div className="completion-proof-grid">
          <label className="form-label">金额（元）<input inputMode="decimal" value={completionAmount} onChange={event => setCompletionAmount(event.target.value)} placeholder="例如 128.50" /></label>
          <label className="form-label">账单日期<input type="date" value={completionBillDate} onChange={event => setCompletionBillDate(event.target.value)} /></label>
          <label className="form-label full">完成备注<textarea rows={3} value={completionNote} onChange={event => setCompletionNote(event.target.value)} placeholder="例如：已核对账单并完成付款" /></label>
          {completionExistingFiles.length > 0 && <div className="form-label full completion-attachment-list"><span>已有证明附件</span>{completionExistingFiles.map(file => <div key={file.id} className="completion-attachment-row"><button type="button" onClick={() => openAttachment(file)}><Paperclip size={13} />{file.originalName}</button><button type="button" className="icon-button" aria-label={`删除附件 ${file.originalName}`} onClick={() => { setCompletionExistingFiles(files => files.filter(current => current.id !== file.id)); setCompletionRemovedFileIds(ids => [...ids, file.id]); }}><Trash2 size={14} /></button></div>)}</div>}
          <label className="form-label full completion-file-picker">完成证明附件
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setCompletionFiles(Array.from(event.target.files || []).slice(0, Math.max(0, 5 - completionExistingFiles.length)))} />
            {completionFiles.length > 0 && <small>{completionFiles.map(file => file.name).join('、')}</small>}
          </label>
        </div>
        <div className="modal-foot">
          <button className="secondary-button" onClick={() => setCompletionEditTarget(null)} disabled={!!completingId}>取消</button>
          <button className="primary-button" onClick={saveCompletionEdit} disabled={!!completingId}>{completingId ? '保存中…' : '保存修改'}</button>
        </div>
      </div>
    </div>}

    {completedDetail && !detailSchedule && <div className="modal-backdrop" onMouseDown={() => setCompletedDetail(null)}>
      <div className="complete-modal action-detail-modal" onMouseDown={event => event.stopPropagation()}>
        <button type="button" className="icon-button modal-close" onClick={() => setCompletedDetail(null)} aria-label="关闭详情"><X size={16} /></button>
        <div className="send-schedule-icon"><CheckCircle2 size={23} /></div>
        <h2>{completedDetail.title}</h2>
        <div className="action-detail-meta">
          <span>{completedDetail.itemType === 'recurring' ? '周期事务' : completedDetail.itemType === 'todo' ? '待办' : '日程'}</span>
          <span>计划时间：{formatDate(completedDetail.dueAt, completedDetail.allDay)}</span>
          {completedDetail.completedAt && <span>完成时间：{formatDate(completedDetail.completedAt)}</span>}
        </div>
        {completedDetail.nextAction && <p className="action-detail-note">{completedDetail.nextAction}</p>}
        {completedDetail.proof?.note && <p className="action-detail-note">备注：{completedDetail.proof.note}</p>}
        {completedDetail.proof?.amountCents != null && <p className="action-detail-note">金额：{(completedDetail.proof.amountCents / 100).toFixed(2)} {completedDetail.proof.currency}</p>}
        {completedDetail.proof?.billDate && <p className="action-detail-note">账单日：{completedDetail.proof.billDate}</p>}
        {completedDetail.proof?.attachments.length ? <div className="proof-files">{completedDetail.proof.attachments.map(file => <button key={file.id} onClick={() => openAttachment(file)}><Paperclip size={13} />{file.originalName}</button>)}</div> : null}
        <div className="modal-foot">
          <button type="button" className="secondary-button" onClick={() => setCompletedDetail(null)}>关闭</button>
          <button type="button" className="secondary-button" onClick={() => openCompletionEditor(completedDetail)} disabled={!completedDetail.completionId}><Edit3 size={14} /> 编辑完成记录</button>
          <button type="button" className="primary-button" onClick={() => reopenCompleted(completedDetail)} disabled={reopeningId === completedDetail.id}>{reopeningId === completedDetail.id ? '处理中…' : '设为未完成'}</button>
        </div>
      </div>
    </div>}

    {detailSchedule && <ScheduleDetailModal
      schedule={detailSchedule}
      completionProof={completedDetail?.proof}
      onEditCompletion={completedDetail ? () => openCompletionEditor(completedDetail) : undefined}
      onClose={() => { setDetailSchedule(null); setCompletedDetail(null); }}
      onDelete={deleteScheduleFromDetails}
      onToggle={toggleScheduleFromDetails}
      onEdit={schedule => { setDetailSchedule(null); setCompletedDetail(null); setEditingSchedule(schedule); }}
    />}

    {editingSchedule && <ScheduleFormModal
      defaultDate={new Date(editingSchedule.start_time)}
      editingSchedule={editingSchedule}
      onSave={saveScheduleEdit}
      onClose={() => setEditingSchedule(null)}
    />}
  </div>;
}
