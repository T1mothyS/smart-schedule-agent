import { executeWithoutSave, queryAll, queryOne, run, runTransaction } from '../connection.js';
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
     (id, user_id, content, is_optimized, optimization_count, optimization_previous_content, content_revision,
      completed, completed_at, color, linked_schedule_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.user_id,
      item.content,
      item.is_optimized ? 1 : 0,
      Math.max(0, Math.trunc(Number(item.optimization_count) || 0)),
      item.optimization_previous_content || null,
      Math.max(0, Math.trunc(Number(item.content_revision) || 0)),
      item.completed ? 1 : 0,
      item.completed_at,
      item.color || 'neutral',
      item.linked_schedule_ids || '[]',
      item.created_at,
      item.updated_at,
    ],
  );
  return item;
}

export function updateNoteItem(
  id: string,
  userId: string,
  updates: Partial<Pick<DbNoteItem, 'content' | 'is_optimized' | 'optimization_count' | 'optimization_previous_content' | 'content_revision' | 'completed' | 'completed_at' | 'color' | 'linked_schedule_ids' | 'updated_at'>>,
  expected: { content?: string; contentRevision?: number } = {},
): DbNoteItem | undefined {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.is_optimized !== undefined) {
    fields.push('is_optimized = ?');
    values.push(updates.is_optimized ? 1 : 0);
  }
  if (updates.optimization_count !== undefined) {
    fields.push('optimization_count = ?');
    values.push(Math.max(0, Math.trunc(Number(updates.optimization_count) || 0)));
  }
  if (updates.optimization_previous_content !== undefined) {
    fields.push('optimization_previous_content = ?');
    values.push(updates.optimization_previous_content || null);
  }
  if (updates.content_revision !== undefined) {
    fields.push('content_revision = ?');
    values.push(Math.max(0, Math.trunc(Number(updates.content_revision) || 0)));
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
  values.push(updates.updated_at || new Date().toISOString());
  const predicates = ['id = ?', 'user_id = ?'];
  const predicateValues: unknown[] = [id, userId];
  if (expected.content !== undefined) {
    predicates.push('content = ?');
    predicateValues.push(expected.content);
  }
  if (expected.contentRevision !== undefined) {
    predicates.push('content_revision = ?');
    predicateValues.push(expected.contentRevision);
  }
  const result = run(`UPDATE note_items SET ${fields.join(', ')} WHERE ${predicates.join(' AND ')}`, [...values, ...predicateValues]);
  return result.changes > 0 ? getNoteItem(id, userId) : undefined;
}

export function commitNoteOptimization(
  id: string,
  userId: string,
  expectedContent: string,
  expectedRevision: number,
  optimizedContent: string,
  updatedAt = new Date().toISOString(),
): DbNoteItem | undefined {
  const result = run(
    `UPDATE note_items
     SET content = ?, is_optimized = 1, optimization_count = optimization_count + 1,
         optimization_previous_content = ?, content_revision = content_revision + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND content = ? AND content_revision = ? AND is_optimized = 0`,
    [optimizedContent, expectedContent, updatedAt, id, userId, expectedContent, expectedRevision],
  );
  return result.changes > 0 ? getNoteItem(id, userId) : undefined;
}

export function revertNoteOptimization(
  id: string,
  userId: string,
  expectedContent: string,
  expectedRevision: number,
  updatedAt = new Date().toISOString(),
): DbNoteItem | undefined {
  const result = run(
    `UPDATE note_items
     SET content = optimization_previous_content, is_optimized = 0,
         optimization_previous_content = NULL, content_revision = content_revision + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND content = ? AND content_revision = ?
       AND is_optimized = 1 AND optimization_previous_content IS NOT NULL`,
    [updatedAt, id, userId, expectedContent, expectedRevision],
  );
  return result.changes > 0 ? getNoteItem(id, userId) : undefined;
}

export function mergeNoteItems(
  sourceId: string,
  userId: string,
  targetId: string,
  mergedContent: string,
  completedAt: string,
): { source: DbNoteItem; target: DbNoteItem } | undefined {
  return runTransaction(() => {
    const source = getNoteItem(sourceId, userId);
    const target = getNoteItem(targetId, userId);
    if (!source || !target) return undefined;

    executeWithoutSave(
      `UPDATE note_items
       SET content = ?, is_optimized = 0, optimization_previous_content = NULL,
           content_revision = content_revision + 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [mergedContent, completedAt, targetId, userId],
    );
    executeWithoutSave(
      'UPDATE note_items SET completed = 1, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [completedAt, completedAt, sourceId, userId],
    );

    const updatedSource = getNoteItem(sourceId, userId);
    const updatedTarget = getNoteItem(targetId, userId);
    if (!updatedSource || !updatedTarget) throw new Error('合并记事后读取失败');
    return { source: updatedSource, target: updatedTarget };
  });
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
    const rawOptimized = rawRow.is_optimized ?? rawRow.isOptimized;
    const rawOptimizationCount = rawRow.optimization_count ?? rawRow.optimizationCount;
    const optimizationCount = Number.isInteger(Number(rawOptimizationCount)) && Number(rawOptimizationCount) >= 0
      ? Number(rawOptimizationCount)
      : 0;
    const rawPreviousContent = rawRow.optimization_previous_content ?? rawRow.optimizationPreviousContent;
    const previousContent = typeof rawPreviousContent === 'string' && rawPreviousContent.trim()
      ? rawPreviousContent.trim().slice(0, 2_000)
      : null;
    const isOptimized = (rawOptimized === true || Number(rawOptimized) === 1) && previousContent !== null;
    const rawRevision = rawRow.content_revision ?? rawRow.contentRevision;
    const contentRevision = Number.isInteger(Number(rawRevision)) && Number(rawRevision) >= 0 ? Number(rawRevision) : 0;
    createNoteItem({
      id,
      user_id: userId,
      content,
      is_optimized: isOptimized ? 1 : 0,
      optimization_count: optimizationCount,
      optimization_previous_content: isOptimized ? previousContent : null,
      content_revision: contentRevision,
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
