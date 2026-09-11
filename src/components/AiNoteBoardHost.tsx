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
  deleteNote: (note: NoteItem) => Promise<void>;
  sendToAi: (note: NoteItem) => void;
}

interface UseAiNoteBoardOptions {
  initialNoteId?: string;
  onSendToAi: (note: NoteItem) => void;
}

export function useAiNoteBoard({ initialNoteId, onSendToAi }: UseAiNoteBoardOptions): AiNoteBoardController {
  const { isAuthenticated, authHeaders } = useAuth();
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const deleteNote = useCallback(async (note: NoteItem) => {
    try {
      const response = await fetch(`/api/note-items/${encodeURIComponent(note.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.success) throw new Error(data.error || '删除记事失败');
      setNotes(previous => previous.filter(item => item.id !== note.id));
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除记事失败');
      throw deleteError;
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
  const sendToAi = useCallback((note: NoteItem) => onSendToAi(note), [onSendToAi]);

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
    deleteNote,
    sendToAi,
  };
}

export function AiNoteBoardHost({ controller, aiBusy = false }: {
  controller: AiNoteBoardController;
  aiBusy?: boolean;
}) {
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
        onDelete={controller.deleteNote}
        onSendToAi={controller.sendToAi}
      />
      {controller.drawerOpen && (
        <button type="button" className="note-board-scrim" onClick={controller.closeDrawer} aria-label="关闭记事板" />
      )}
    </>
  );
}
