import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, CircleX, Copy, Forward, GitMerge, ListPlus, Pencil, RotateCcw, StickyNote, X } from 'lucide-react';
import { formatNotesAsCsv, formatNotesAsText, noteExportFilename } from '../utils/note-export';
import { NOTE_COLORS, NOTE_COLOR_LABELS, NOTE_COLOR_STYLES, normaliseNoteColor, type NoteColor } from '../utils/note-colors';

export interface NoteItem {
  id: string;
  content: string;
  completed: boolean;
  completedAt: string | null;
  color: NoteColor;
  /** @deprecated 仅为旧 API/备份兼容保留，界面不展示。 */
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
  onColorChange: (note: NoteItem, color: NoteColor) => Promise<void>;
  onMerge: (source: NoteItem, target: NoteItem) => Promise<void>;
  onSendToAi: (note: NoteItem) => void;
}

function NoteColorPicker({ note, disabled, open, onToggle, onChange }: {
  note: NoteItem & { displayIndex: number };
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (color: NoteColor) => void;
}) {
  const color = normaliseNoteColor(note.color);
  const style = NOTE_COLOR_STYLES[color];
  return (
    <div className="note-board-color-picker">
      <button
        type="button"
        className="note-board-color-number"
        style={{ color: style.accent, backgroundColor: style.surface, borderColor: style.border }}
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`记事编号 ${note.displayIndex}，当前颜色：${NOTE_COLOR_LABELS[color]}，点击更换颜色`}
        title={`编号 ${note.displayIndex} · 当前颜色：${NOTE_COLOR_LABELS[color]}；点击更换`}
      >
        {note.displayIndex}
      </button>
      {open && (
        <div className="note-board-color-menu" role="menu" aria-label="选择记事颜色">
          {NOTE_COLORS.map(option => {
            const optionStyle = NOTE_COLOR_STYLES[option];
            const selected = option === color;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? 'is-selected' : ''}
                onClick={() => onChange(option)}
                disabled={disabled}
              >
                <span className="note-board-color-dot" style={{ backgroundColor: optionStyle.accent }} aria-hidden="true" />
                <span>{NOTE_COLOR_LABELS[option]}</span>
                {selected && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type CopyFeedback = 'success' | 'error' | null;

function NoteRow({
  note,
  displayIndex,
  selected,
  aiBusy,
  editing,
  editValue,
  saving,
  colorPickerOpen,
  copyFeedback,
  mergeSourceSelected,
  mergeSourceExists,
  mergeBusy,
  onToggleSelected,
  onStartEdit,
  onEditValueChange,
  onSaveEdit,
  onCancelEdit,
  onChangeColor,
  onToggleCompleted,
  onMerge,
  onCopy,
  onSendToAi,
  onToggleColorPicker,
}: {
  note: NoteItem & { displayIndex: number };
  displayIndex: number;
  selected: boolean;
  aiBusy: boolean;
  editing: boolean;
  editValue: string;
  saving: boolean;
  colorPickerOpen: boolean;
  copyFeedback: CopyFeedback;
  mergeSourceSelected: boolean;
  mergeSourceExists: boolean;
  mergeBusy: boolean;
  onToggleSelected: () => void;
  onStartEdit: () => void;
  onEditValueChange: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onChangeColor: (color: NoteColor) => void;
  onToggleCompleted: () => void;
  onMerge: () => void;
  onCopy: () => void;
  onSendToAi: () => void;
  onToggleColorPicker: () => void;
}) {
  const color = normaliseNoteColor(note.color);
  const colorStyle = NOTE_COLOR_STYLES[color];
  const disabled = aiBusy || saving || mergeBusy;
  const mergeTitle = mergeSourceSelected
    ? '取消合并来源'
    : mergeSourceExists
      ? '合并到此记事'
      : '选择为合并来源';
  return (
    <article
      className={`note-board-row${note.completed ? ' is-completed' : ''}${colorPickerOpen ? ' is-color-picker-open' : ''}${mergeSourceSelected ? ' is-merge-source' : ''}`}
      style={{ backgroundColor: colorStyle.surface, borderColor: colorStyle.border }}
    >
      <div className="note-board-row-toolbar">
        <label className="note-board-select" title={selected ? '取消选择' : '选择记事'}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`${selected ? '取消选择' : '选择'}记事：${note.content}`}
          />
          <span aria-hidden="true" />
        </label>
        <button
          type="button"
          className="note-board-action"
          onClick={editing ? onSaveEdit : onStartEdit}
          disabled={disabled}
          title={editing ? '确认保存' : '编辑记事'}
          aria-label={editing ? `保存记事：${note.content}` : `编辑记事：${note.content}`}
        >
          {editing ? <Check size={15} /> : <Pencil size={15} />}
        </button>
        <button type="button" className="note-board-action" onClick={onSendToAi} disabled={disabled} title="送入 AI 队列" aria-label={`送入 AI 队列：${note.content}`}><ListPlus size={15} /></button>
        <button type="button" className="note-board-action" onClick={onCopy} disabled={disabled} title={copyFeedback === 'success' ? '已复制' : copyFeedback === 'error' ? '复制失败' : '复制正文'} aria-label={`复制记事：${note.content}`}>
          {copyFeedback === 'success' ? <Check size={15} /> : copyFeedback === 'error' ? <CircleX size={15} /> : <Copy size={15} />}
        </button>
        <button type="button" className="note-board-action" onClick={onToggleCompleted} disabled={disabled} title={note.completed ? '恢复到进行中' : '移入废纸篓'} aria-label={note.completed ? `恢复记事：${note.content}` : `完成记事并移入废纸篓：${note.content}`}>
          {note.completed ? <RotateCcw size={15} /> : <Forward size={15} />}
        </button>
        <button
          type="button"
          className={`note-board-action${mergeSourceSelected ? ' is-merge-source' : ''}`}
          onClick={onMerge}
          disabled={disabled}
          title={mergeTitle}
          aria-label={`${mergeTitle}：${note.content}`}
          aria-pressed={mergeSourceSelected}
        >
          <GitMerge size={15} />
        </button>
      </div>

      <div className="note-board-row-content">
        <NoteColorPicker
          note={{ ...note, displayIndex }}
          disabled={disabled}
          open={colorPickerOpen}
          onToggle={onToggleColorPicker}
          onChange={onChangeColor}
        />
        <div className="note-board-row-text">
          {editing ? (
            <textarea
              className="note-board-edit-input"
              value={editValue}
              onChange={event => onEditValueChange(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter' && event.ctrlKey) {
                  event.preventDefault();
                  onSaveEdit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelEdit();
                }
              }}
              disabled={disabled}
              autoFocus
              aria-label="编辑记事正文"
            />
          ) : (
            <button type="button" className="note-board-content-button" onClick={onStartEdit} disabled={disabled}>
              {note.content}
            </button>
          )}
        </div>
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
  onColorChange,
  onMerge,
  onSendToAi,
}: NoteBoardProps) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; kind: CopyFeedback }>({ id: '', kind: null });
  const drawerRef = useRef<HTMLElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onCloseDrawer]);

  useEffect(() => {
    setSelectedIds(new Set());
    setColorPickerId(null);
    setMergeSourceId(previous => previous && notes.some(note => note.id === previous) ? previous : null);
  }, [notes]);

  useEffect(() => {
    if (!drawerOpen) setMergeSourceId(null);
  }, [drawerOpen]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const startEdit = (note: NoteItem) => {
    if (aiBusy) return;
    setEditingId(note.id);
    setEditValue(note.content);
    setColorPickerId(null);
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

  const changeColor = async (note: NoteItem, color: NoteColor) => {
    if (normaliseNoteColor(note.color) === color) {
      setColorPickerId(null);
      return;
    }
    setSavingId(note.id);
    try {
      await onColorChange(note, color);
      setColorPickerId(null);
    } catch {
      // 父组件负责显示错误；保留色板以便重试。
    } finally {
      setSavingId(null);
    }
  };

  const copyNote = async (note: NoteItem) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持剪贴板');
      await navigator.clipboard.writeText(note.content);
      setCopyFeedback({ id: note.id, kind: 'success' });
    } catch {
      setCopyFeedback({ id: note.id, kind: 'error' });
    }
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyFeedback({ id: '', kind: null }), 1500);
  };

  const activeNotes = notes
    .filter(note => !note.completed)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const trashNotes = notes
    .filter(note => note.completed)
    .sort((left, right) => (right.completedAt || right.updatedAt).localeCompare(left.completedAt || left.updatedAt));

  const toggleSelected = (id: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectSection = (sectionNotes: NoteItem[]) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      sectionNotes.forEach(note => next.add(note.id));
      return next;
    });
  };

  const clearSection = (sectionNotes: NoteItem[]) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      sectionNotes.forEach(note => next.delete(note.id));
      return next;
    });
  };

  const downloadSection = (section: 'active' | 'trash', sectionNotes: NoteItem[], format: 'txt' | 'csv') => {
    const selected = sectionNotes.filter(note => selectedIds.has(note.id));
    if (!selected.length) return;
    const content = format === 'txt' ? formatNotesAsText(selected, section) : formatNotesAsCsv(selected, section);
    const blob = new Blob([content], { type: format === 'txt' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${noteExportFilename(section)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const completeOrRestore = async (note: NoteItem) => {
    try {
      await onToggleCompleted(note);
      setSelectedIds(previous => {
        const next = new Set(previous);
        next.delete(note.id);
        return next;
      });
    } catch {
      // 父组件已显示错误，失败时保留当前选择以便继续操作。
    }
  };

  const mergeNote = async (note: NoteItem) => {
    if (mergeBusy) return;
    if (!mergeSourceId) {
      setMergeSourceId(note.id);
      setEditingId(null);
      setColorPickerId(null);
      return;
    }
    if (mergeSourceId === note.id) {
      setMergeSourceId(null);
      return;
    }
    const source = notes.find(item => item.id === mergeSourceId);
    if (!source) {
      setMergeSourceId(null);
      return;
    }
    setMergeBusy(true);
    try {
      await onMerge(source, note);
      setMergeSourceId(null);
      setSelectedIds(previous => {
        const next = new Set(previous);
        next.delete(source.id);
        next.delete(note.id);
        return next;
      });
    } catch {
      // 父组件已显示错误；保留来源选择，便于换目标重试。
    } finally {
      setMergeBusy(false);
    }
  };

  const renderRow = (note: NoteItem, displayIndex: number) => (
    <NoteRow
      key={note.id}
      note={{ ...note, displayIndex }}
      displayIndex={displayIndex}
      selected={selectedIds.has(note.id)}
      aiBusy={aiBusy}
      editing={editingId === note.id}
      editValue={editingId === note.id ? editValue : note.content}
      saving={savingId === note.id}
      colorPickerOpen={colorPickerId === note.id}
      copyFeedback={copyFeedback.id === note.id ? copyFeedback.kind : null}
      mergeSourceSelected={mergeSourceId === note.id}
      mergeSourceExists={mergeSourceId !== null}
      mergeBusy={mergeBusy}
      onToggleSelected={() => toggleSelected(note.id)}
      onStartEdit={() => startEdit(note)}
      onEditValueChange={setEditValue}
      onSaveEdit={() => { void saveEdit(note); }}
      onCancelEdit={cancelEdit}
      onChangeColor={color => { void changeColor(note, color); }}
      onToggleCompleted={() => { void completeOrRestore(note); }}
      onMerge={() => { void mergeNote(note); }}
      onCopy={() => { void copyNote(note); }}
      onSendToAi={() => onSendToAi(note)}
      onToggleColorPicker={() => setColorPickerId(current => current === note.id ? null : note.id)}
    />
  );

  const renderSectionTools = (section: 'active' | 'trash', sectionNotes: NoteItem[]) => {
    const selectedCount = sectionNotes.filter(note => selectedIds.has(note.id)).length;
    return (
      <div className="note-board-section-tools">
        <span>{selectedCount ? `已选 ${selectedCount}` : '未选择'}</span>
        <button type="button" onClick={() => selectSection(sectionNotes)} disabled={!sectionNotes.length}>全选</button>
        <button type="button" onClick={() => clearSection(sectionNotes)} disabled={!selectedCount}>全不选</button>
        <button type="button" onClick={() => downloadSection(section, sectionNotes, 'txt')} disabled={!selectedCount}>导出 TXT</button>
        <button type="button" onClick={() => downloadSection(section, sectionNotes, 'csv')} disabled={!selectedCount}>导出 CSV</button>
      </div>
    );
  };

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
        {mergeSourceId && <div className="note-board-merge-hint" role="status">已选择来源记事，请点击另一张卡片的合并按钮；再次点击来源按钮可取消。复选框仍用于导出。</div>}
        {loading ? <div className="note-board-empty">正在加载记事…</div> : <>
          <section className="note-board-section">
            <div className="note-board-section-head">
              <div><strong>进行中</strong><span>{activeNotes.length}</span></div>
              {renderSectionTools('active', activeNotes)}
            </div>
            {activeNotes.length ? <div className="note-board-list">{activeNotes.map((note, index) => renderRow(note, index + 1))}</div> : <div className="note-board-section-empty">暂无进行中的记事</div>}
          </section>
          <section className="note-board-section note-board-trash-section">
            <button type="button" className="note-board-section-toggle" onClick={() => setCompletedOpen(open => !open)} aria-expanded={completedOpen}>
              <span><strong>废纸篓</strong><em>{trashNotes.length}</em></span>
              {completedOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {completedOpen && <>
              <div className="note-board-section-head note-board-trash-tools">{renderSectionTools('trash', trashNotes)}</div>
              {trashNotes.length ? <div className="note-board-list">{trashNotes.map((note, index) => renderRow(note, index + 1))}</div> : <div className="note-board-section-empty">废纸篓是空的</div>}
            </>}
          </section>
          {notes.length === 0 && <div className="note-board-empty">还没有记事<br /><span>在输入框打开记事模式即可快速记录</span></div>}
        </>}
      </div>
      <span className="sr-only">送入队列会作为普通 AI 对话处理，确认计划后不会自动完成这条记事。</span>
    </aside>
  );
}
