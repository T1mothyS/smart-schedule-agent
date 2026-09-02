import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ClipboardPlus, ListPlus, Pencil, RotateCcw, StickyNote, Trash2, X } from 'lucide-react';

export interface NoteItem {
  id: string;
  content: string;
  completed: boolean;
  completedAt: string | null;
  linkedScheduleIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface NoteBoardProps {
  id?: string;
  notes: NoteItem[];
  loading: boolean;
  error: string | null;
  aiBusy: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onToggleCompleted: (note: NoteItem) => Promise<void>;
  onEdit: (note: NoteItem, content: string) => Promise<void>;
  onDelete: (note: NoteItem) => Promise<void>;
  onSendToAi: (note: NoteItem) => void;
  onCreateTodo: (note: NoteItem) => void;
}

function formatNoteTime(value: string | null): string {
  if (!value) return '';
  return value.replace('T', ' ').slice(0, 16);
}

function NoteRow({
  note,
  aiBusy,
  editing,
  editValue,
  saving,
  onStartEdit,
  onEditValueChange,
  onSaveEdit,
  onCancelEdit,
  onToggleCompleted,
  onDelete,
  onSendToAi,
  onCreateTodo,
}: {
  note: NoteItem;
  aiBusy: boolean;
  editing: boolean;
  editValue: string;
  saving: boolean;
  onStartEdit: () => void;
  onEditValueChange: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onToggleCompleted: () => void;
  onDelete: () => void;
  onSendToAi: () => void;
  onCreateTodo: () => void;
}) {
  const disabled = aiBusy || saving;
  return (
    <article className={`note-board-row${note.completed ? ' is-completed' : ''}`}>
      <label className="note-board-check" title={note.completed ? '恢复记事' : '完成记事'}>
        <input
          type="checkbox"
          checked={note.completed}
          onChange={onToggleCompleted}
          disabled={disabled}
          aria-label={note.completed ? `恢复记事：${note.content}` : `完成记事：${note.content}`}
        />
        <span aria-hidden="true">{note.completed ? <RotateCcw size={13} /> : <Check size={13} />}</span>
      </label>
      <div className="note-board-row-content">
        {editing ? (
          <input
            className="note-board-edit-input"
            value={editValue}
            onChange={event => onEditValueChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSaveEdit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancelEdit();
              }
            }}
            disabled={disabled}
            autoFocus
            aria-label="编辑记事"
          />
        ) : (
          <button type="button" className="note-board-content-button" onClick={onStartEdit} disabled={disabled}>
            {note.content}
          </button>
        )}
        <div className="note-board-row-meta">
          <span>{formatNoteTime(note.completed ? note.completedAt : note.updatedAt)}</span>
          {note.linkedScheduleIds.length > 0 && <span>已关联 {note.linkedScheduleIds.length} 项待办</span>}
        </div>
      </div>
      <div className="note-board-row-actions">
        {!note.completed && <button type="button" onClick={onSendToAi} disabled={disabled} title="送入 AI 队列" aria-label={`送入 AI 队列：${note.content}`}><ListPlus size={15} /></button>}
        {!note.completed && <button type="button" onClick={onCreateTodo} disabled={disabled} title="创建待办" aria-label={`创建待办：${note.content}`}><ClipboardPlus size={15} /></button>}
        <button type="button" onClick={editing ? onCancelEdit : onStartEdit} disabled={disabled} title={editing ? '取消编辑' : '编辑记事'} aria-label={editing ? '取消编辑' : `编辑记事：${note.content}`}>
          {editing ? <X size={15} /> : <Pencil size={15} />}
        </button>
        <button type="button" className="is-danger" onClick={onDelete} disabled={disabled} title="删除记事" aria-label={`删除记事：${note.content}`}><Trash2 size={15} /></button>
      </div>
    </article>
  );
}

export function NoteBoard({
  id,
  notes,
  loading,
  error,
  aiBusy,
  drawerOpen,
  onCloseDrawer,
  onToggleCompleted,
  onEdit,
  onDelete,
  onSendToAi,
  onCreateTodo,
}: NoteBoardProps) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onCloseDrawer]);

  const startEdit = (note: NoteItem) => {
    if (aiBusy) return;
    setEditingId(note.id);
    setEditValue(note.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const saveEdit = async (note: NoteItem) => {
    const content = editValue.trim();
    if (!content) return;
    setSavingId(note.id);
    try {
      await onEdit(note, content);
      cancelEdit();
    } catch {
      // 父组件会把错误显示在记事板顶部，保留编辑态便于修正后重试。
    } finally {
      setSavingId(null);
    }
  };

  const pending = notes
    .filter(note => !note.completed)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const completed = notes
    .filter(note => note.completed)
    .sort((left, right) => (right.completedAt || right.updatedAt).localeCompare(left.completedAt || left.updatedAt));

  const renderRow = (note: NoteItem) => (
    <NoteRow
      key={note.id}
      note={note}
      aiBusy={aiBusy}
      editing={editingId === note.id}
      editValue={editingId === note.id ? editValue : note.content}
      saving={savingId === note.id}
      onStartEdit={() => startEdit(note)}
      onEditValueChange={setEditValue}
      onSaveEdit={() => { void saveEdit(note); }}
      onCancelEdit={cancelEdit}
      onToggleCompleted={() => { void onToggleCompleted(note).catch(() => {}); }}
      onDelete={() => {
        if (window.confirm(`删除这条记事？\n\n${note.content}`)) void onDelete(note).catch(() => {});
      }}
      onSendToAi={() => onSendToAi(note)}
      onCreateTodo={() => onCreateTodo(note)}
    />
  );

  return (
    <aside id={id} ref={drawerRef} className={`note-board note-board-drawer${drawerOpen ? ' is-open' : ''}`} aria-label="AI 记事板">
      <div className="note-board-header">
        <div className="note-board-heading">
          <span className="note-board-heading-icon"><StickyNote size={17} /></span>
          <div>
            <strong>AI 记事板</strong>
            <span>先记下来，再决定如何安排</span>
          </div>
        </div>
        <button type="button" className="note-board-close" onClick={onCloseDrawer} aria-label="关闭记事板"><X size={17} /></button>
      </div>
      <div className="note-board-body">
        {error && <div className="note-board-error" role="alert">{error}</div>}
        {loading ? <div className="note-board-empty">正在加载记事…</div> : notes.length === 0 ? <div className="note-board-empty">还没有记事<br /><span>在输入框打开“记事模式”即可快速记录</span></div> : <>
          <section className="note-board-section">
            <div className="note-board-section-head"><strong>进行中</strong><span>{pending.length}</span></div>
            {pending.length ? <div className="note-board-list">{pending.map(renderRow)}</div> : <div className="note-board-section-empty">暂无进行中的记事</div>}
          </section>
          <section className="note-board-section note-board-completed-section">
            <button type="button" className="note-board-section-toggle" onClick={() => setCompletedOpen(open => !open)} aria-expanded={completedOpen}>
              <span><strong>已完成</strong><em>{completed.length}</em></span>
              {completedOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {completedOpen && (completed.length ? <div className="note-board-list">{completed.map(renderRow)}</div> : <div className="note-board-section-empty">还没有完成的记事</div>)}
          </section>
        </>}
      </div>
    </aside>
  );
}
