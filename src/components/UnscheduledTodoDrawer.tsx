import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ScheduleFormModal } from './calendar/ScheduleFormModal';
import type { Schedule } from './calendar/schedule-types';
import '../styles/unscheduled.css';

interface Completion { id: string; completedAt: string; reopenedAt: string | null; note: string | null }

export function UnscheduledTodoDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { authHeaders } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Schedule[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Completion[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/schedules/unscheduled', { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载待办失败');
      setRows(data.schedules);
    } catch (e) { setError(e instanceof Error ? e.message : '加载待办失败'); }
    finally { setLoading(false); }
  }, [authHeaders]);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { previous?.focus(); }; }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    setHistory([]); setHistoryError(''); setHistoryLoading(true);
    fetch('/api/history?sourceType=schedule&sourceId=' + encodeURIComponent(selected), { headers: authHeaders(), signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error('完成记录读取失败'); return response.json(); })
      .then(data => { if (!abort.signal.aborted) setHistory(data.completions); })
      .catch(e => { if (!abort.signal.aborted) setHistoryError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setHistoryLoading(false); });
    return () => abort.abort();
  }, [selected, authHeaders]);
  const mutate = async (id: string, method: string, body?: Partial<Schedule>, toggle = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/schedules/' + encodeURIComponent(id) + (toggle ? '/toggle' : ''), {
        method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作失败');
      setEditing(null); setSelected(null); await load(); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  };
  const completed = rows.filter(row => row.is_completed).length;
  const visible = rows.filter(row => (filter === 'all' || row.is_completed === (filter === 'completed'))
    && [row.title, row.description, row.notes].some(text => (text || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  return <dialog ref={dialog} className="unscheduled-drawer" aria-labelledby="unscheduled-title"
    onCancel={event => { event.preventDefault(); if (busy) return; if (editing) setEditing(null); else onClose(); }}>
    <header><div><h2 id="unscheduled-title">无固定期限待办</h2><p>没有执行期限；完成后仍可在这里查看和管理。</p></div>
      <button className="secondary-button" disabled={busy} onClick={onClose}>关闭</button></header>
    <div className="unscheduled-filters">
      <label>状态<select aria-label="状态" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">全部（{rows.length}）</option><option value="pending">未完成（{rows.length - completed}）</option><option value="completed">已完成（{completed}）</option>
      </select></label>
      <label>搜索<input value={query} onChange={e => setQuery(e.target.value)} placeholder="标题、描述或备注" /></label>
    </div>
    {error && <div role="alert">{error}<button className="secondary-button" disabled={busy || loading} onClick={() => void load()}>重新加载</button></div>}
    <div className="unscheduled-list" aria-busy={loading || busy}>
      {loading ? <p role="status">正在加载待办…</p> : visible.length === 0 ? <p>没有符合条件的待办</p> : visible.map(row => <article key={row.id}>
        <h3>{row.title}</h3><p>{row.is_completed ? '已完成' : '未完成'} · {{ high: '高', medium: '中', low: '低' }[row.priority]}优先级</p>
        <div className="unscheduled-actions">
          <button className="secondary-button" aria-expanded={selected === row.id} onClick={() => setSelected(selected === row.id ? null : row.id)}>详情</button>
          <button className="secondary-button" disabled={busy} onClick={() => setEditing(row)}>编辑</button>
          <button className="secondary-button" disabled={busy} onClick={() => void mutate(row.id, 'POST', undefined, true)}>{row.is_completed ? '设为未完成' : '标记完成'}</button>
          <button className="secondary-button" disabled={busy} onClick={() => { if (window.confirm(`确定删除“${row.title}”吗？`)) void mutate(row.id, 'DELETE'); }}>删除</button>
        </div>
        {selected === row.id && <div className="unscheduled-details">
          <p>历史保存时间（不是执行期限）：{row.start_time}</p>
          {row.description && <p>描述：{row.description}</p>}{row.notes && <p>备注：{row.notes}</p>}
          <h4>完成记录</h4>{historyLoading ? <p>读取中…</p> : historyError ? <p role="alert">{historyError}</p> : history.length === 0 ? <p>无完成记录；当前状态以待办为准。</p> : history.map(item => <p key={item.id}>{item.completedAt}{item.reopenedAt ? '（已重新打开）' : ''}{item.note ? '：' + item.note : ''}</p>)}
        </div>}
      </article>)}
    </div>
    {editing && <div className="unscheduled-editor" aria-busy={busy}>
      {error && <p className="unscheduled-edit-error" role="alert">{error}</p>}
      <ScheduleFormModal editingSchedule={editing} defaultDate={new Date()} onClose={() => { if (!busy) setEditing(null); }} onSave={body => void mutate(editing.id, 'PUT', body)} />
    </div>}
  </dialog>;
}
