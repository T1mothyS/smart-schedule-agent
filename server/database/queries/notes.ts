import { queryAll, queryOne, run } from '../connection.js';
import { escapeLike } from './search-utils.js';
import type { DbNoteItem } from '../types.js';
import crypto from 'node:crypto';

export function getNoteItem(id: string, userId: string): DbNoteItem | undefined {
  return queryOne<DbNoteItem>('SELECT * FROM note_items WHERE id = ? AND user_id = ?', [id, userId]);
}

export function listNoteItems(userId: string): DbNoteItem[] {
  return queryAll<DbNoteItem>(
    'SELECT * FROM note_items WHERE user_id = ? ORDER BY completed ASC, updated_at DESC, created_at DESC',
    [userId],
  );
}

export function searchNoteItems(userId: string, query: string, limit = 100): DbNoteItem[] {
  const pattern = `%${escapeLike(query.trim())}%`;
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 100);
  return queryAll<DbNoteItem>(
    `SELECT * FROM note_items
     WHERE user_id = ? AND content LIKE ? ESCAPE '\\'
     ORDER BY completed ASC, updated_at DESC, created_at DESC
     LIMIT ?`,
    [userId, pattern, safeLimit],
  );
}

export function createNoteItem(item: DbNoteItem): DbNoteItem {
  run(
    `INSERT INTO note_items
     (id, user_id, content, completed, completed_at, color, linked_schedule_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.user_id, item.content, item.completed ? 1 : 0, item.completed_at, item.color || 'neutral', item.linked_schedule_ids || '[]', item.created_at, item.updated_at],
  );
  return item;
}

export function updateNoteItem(
  id: string,
  userId: string,
  updates: Partial<Pick<DbNoteItem, 'content' | 'completed' | 'completed_at' | 'color' | 'linked_schedule_ids' | 'updated_at'>>,
): DbNoteItem | undefined {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.completed !== undefined) {
    fields.push('completed = ?');
    values.push(updates.completed ? 1 : 0);
  }
  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }
  if (updates.color !== undefined) {
    fields.push('color = ?');
    values.push(updates.color);
  }
  if (updates.linked_schedule_ids !== undefined) {
    fields.push('linked_schedule_ids = ?');
    values.push(updates.linked_schedule_ids);
  }
  if (!fields.length) return getNoteItem(id, userId);
  fields.push('updated_at = ?');
  values.push(updates.updated_at || new Date().toISOString(), id, userId);
  run(`UPDATE note_items SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  return getNoteItem(id, userId);
}

export function deleteNoteItem(id: string, userId: string): boolean {
  return run('DELETE FROM note_items WHERE id = ? AND user_id = ?', [id, userId]).changes > 0;
}

export function restoreLinkedScheduleIds(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  return Array.isArray(parsed)
    ? [...new Set(parsed.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 100)
    : [];
}

export function exportUserNoteItems(userId: string): DbNoteItem[] {
  return listNoteItems(userId);
}

export function restoreUserNoteItems(
  userId: string,
  rows: Array<Partial<DbNoteItem> & { linkedScheduleIds?: unknown; completedAt?: unknown; color?: unknown }>,
  mode: 'merge' | 'replace',
): { items: number } {
  if (mode === 'replace') run('DELETE FROM note_items WHERE user_id = ?', [userId]);
  let items = 0;
  for (const row of rows || []) {
    const content = String(row.content || '').trim().slice(0, 2_000);
    if (!content) continue;
    const id = String(row.id || '').trim() || crypto.randomUUID();
    if (getNoteItem(id, userId)) continue;
    const now = new Date().toISOString();
    const rawRow = row as any;
    const completed = rawRow.completed === true || Number(rawRow.completed) === 1;
    const updatedAt = String(rawRow.updated_at || rawRow.updatedAt || now);
    const createdAt = String(rawRow.created_at || rawRow.createdAt || updatedAt);
    const completedAt = completed
      ? String(rawRow.completed_at || rawRow.completedAt || updatedAt)
      : null;
    const colorValues = ['neutral', 'purple', 'blue', 'green', 'amber', 'rose'] as const;
    const colorValue = String(rawRow.color || 'neutral');
    const color = (colorValues as readonly string[]).includes(colorValue) ? colorValue : 'neutral';
    createNoteItem({
      id,
      user_id: userId,
      content,
      completed: completed ? 1 : 0,
      completed_at: completedAt,
      color,
      linked_schedule_ids: JSON.stringify(restoreLinkedScheduleIds(row.linked_schedule_ids ?? row.linkedScheduleIds)),
      created_at: createdAt,
      updated_at: updatedAt,
    });
    items++;
  }
  return { items };
}
