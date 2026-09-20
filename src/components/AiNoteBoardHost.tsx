import { PromptOptimizeDialog } from './PromptOptimizeDialog';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { NoteBoard, type NoteItem } from './NoteBoard';

async function readJsonResponse(response: Response): Promise<any> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const contentType = response.headers.get('content-type') || '未知类型';
    const preview = raw.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`服务返回了非 JSON 内容（${contentType}）：${preview || '空响应'}。请检查代理超时或服务状态。`);
  }
}

export interface AiNoteBoardController {
  notes: NoteItem[];
  loading: boolean;
  error: string | null;
  drawerOpen: boolean;
  pendingCount: number;
  toggleDrawer: () => void;
  closeDrawer: () => void;
  createNote: (content: string) => Promise<void>;
  toggleCompleted: (note: NoteItem) => Promise<void>;
  edit: (note: NoteItem, content: string) => Promise<void>;
  changeColor: (note: NoteItem, color: NoteItem['color']) => Promise<void>;
  merge: (source: NoteItem, target: NoteItem) => Promise<void>;
  replaceOptimized: (note: NoteItem, content: string) => Promise<void>;
}

interface UseAiNoteBoardOptions {
  initialNoteId?: string;
}

export function useAiNoteBoard({ initialNoteId }: UseAiNoteBoardOptions): AiNoteBoardController {
  const { isAuthenticated, authHeaders } = useAuth();
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 861px)').matches
  ));

  useEffect(() => {
    if (initialNoteId) setDrawerOpen(true);
  }, [initialNoteId]);

  const loadNotes = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const response = await fetch('/api/note-items', { headers: authHeaders() });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '获取记事失败');
      setNotes(Array.isArray(data.items) ? data.items : []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '获取记事失败');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) void loadNotes();
    else setNotes([]);
  }, [isAuthenticated, loadNotes]);

  const updateNote = useCallback(async (id: string, body: Record<string, unknown>) => {
    const response = await fetch(`/api/note-items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await readJsonResponse(response);
    if (!response.ok || !data.item) throw new Error(data.error || '更新记事失败');
    setNotes(previous => previous.map(item => item.id === id ? data.item : item));
    setError(null);
  }, [authHeaders]);

  const toggleCompleted = useCallback(async (note: NoteItem) => {
    try {
      await updateNote(note.id, { completed: !note.completed });
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '更新记事失败');
      throw toggleError;
    }
  }, [updateNote]);

  const edit = useCallback(async (note: NoteItem, content: string) => {
    try {
      await updateNote(note.id, { content });
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : '更新记事失败');
      throw editError;
    }
  }, [updateNote]);

  const changeColor = useCallback(async (note: NoteItem, color: NoteItem['color']) => {
    try {
      await updateNote(note.id, { color });
    } catch (colorError) {
      setError(colorError instanceof Error ? colorError.message : '更新记事颜色失败');
      throw colorError;
    }
  }, [updateNote]);

  const merge = useCallback(async (source: NoteItem, target: NoteItem) => {
    try {
      const response = await fetch(`/api/note-items/${encodeURIComponent(source.id)}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ targetId: target.id }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.source || !data.target) throw new Error(data.error || '合并记事失败');
      setNotes(previous => previous.map(item => (
        item.id === data.source.id ? data.source : item.id === data.target.id ? data.target : item
      )));
      setError(null);
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : '合并记事失败');
      throw mergeError;
    }
  }, [authHeaders]);

  const createNote = useCallback(async (content: string) => {
    const trimmedContent = content.trim();
    if (!trimmedContent) return;
    try {
      const response = await fetch('/api/note-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ content: trimmedContent }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '保存记事失败');
      const created = Array.isArray(data.items) ? data.items as NoteItem[] : [];
      setNotes(previous => [...created, ...previous]);
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '保存记事失败');
      throw createError;
    }
  }, [authHeaders]);

  const toggleDrawer = useCallback(() => setDrawerOpen(open => !open), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const replaceOptimized = useCallback((note: NoteItem, content: string) => updateNote(note.id, { content, expectedContent: note.content }), [updateNote]);

  return {
    notes,
    loading,
    error,
    drawerOpen,
    pendingCount: notes.filter(note => !note.completed).length,
    toggleDrawer,
    closeDrawer,
    createNote,
    toggleCompleted,
    edit,
    changeColor,
    merge,
    replaceOptimized,
  };
}

export function AiNoteBoardHost({ controller, aiBusy = false }: {
  controller: AiNoteBoardController;
  aiBusy?: boolean;
}) {
  const [optimizing, setOptimizing] = useState<NoteItem | null>(null);
  return (
    <>
      <NoteBoard
        id="ai-note-board"
        notes={controller.notes}
        loading={controller.loading}
        error={controller.error}
        aiBusy={aiBusy}
        drawerOpen={controller.drawerOpen}
        onCloseDrawer={controller.closeDrawer}
        onToggleCompleted={controller.toggleCompleted}
        onEdit={controller.edit}
        onColorChange={controller.changeColor}
        onMerge={controller.merge}
        onOptimize={setOptimizing}
      />
      {optimizing && <PromptOptimizeDialog note={optimizing} onClose={() => setOptimizing(null)} onReplace={controller.replaceOptimized} />}
      {controller.drawerOpen && (
        <button type="button" className="note-board-scrim" onClick={controller.closeDrawer} aria-label="关闭记事板" />
      )}
    </>
  );
}
