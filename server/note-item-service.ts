import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

export const NOTE_CONTENT_MAX_LENGTH = 2_000;
export const NOTE_BATCH_MAX = 100;
export const NOTE_BATCH_TOTAL_MAX_LENGTH = 20_000;

export interface NoteItem {
  id: string;
  content: string;
  completed: boolean;
  completedAt: string | null;
  linkedScheduleIds: string[];
  createdAt: string;
  updatedAt: string;
}

function parseLinkedScheduleIds(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  return Array.isArray(parsed)
    ? [...new Set(parsed.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 100)
    : [];
}

function toNoteItem(row: db.DbNoteItem): NoteItem {
  return {
    id: row.id,
    content: row.content,
    completed: row.completed === 1,
    completedAt: row.completed_at || null,
    linkedScheduleIds: parseLinkedScheduleIds(row.linked_schedule_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNoteItems(userId: string): NoteItem[] {
  return db.listNoteItems(userId).map(toNoteItem);
}

export function getNoteItem(userId: string, id: string): NoteItem | undefined {
  const row = db.getNoteItem(id, userId);
  return row ? toNoteItem(row) : undefined;
}

export function normaliseNoteContents(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/)
      : [];
  return source
    .map(item => String(item ?? '').trim())
    .filter(Boolean);
}

function validateContent(content: unknown): string {
  const value = String(content ?? '').trim();
  if (!value) throw new Error('记事内容不能为空');
  if (value.length > NOTE_CONTENT_MAX_LENGTH) throw new Error(`单条记事不能超过 ${NOTE_CONTENT_MAX_LENGTH} 个字符`);
  return value;
}

export function createNoteItems(userId: string, contents: unknown): NoteItem[] {
  const values = normaliseNoteContents(contents);
  if (values.length > NOTE_BATCH_MAX) throw new Error(`一次最多保存 ${NOTE_BATCH_MAX} 条记事`);
  const validated = values.map(validateContent);
  const totalLength = validated.reduce((sum, value) => sum + value.length, 0);
  if (totalLength > NOTE_BATCH_TOTAL_MAX_LENGTH) throw new Error(`一次保存的记事总长度不能超过 ${NOTE_BATCH_TOTAL_MAX_LENGTH} 个字符`);
  const now = new Date().toISOString();
  return validated.map(content => toNoteItem(db.createNoteItem({
    id: uuidv4(),
    user_id: userId,
    content,
    completed: 0,
    completed_at: null,
    linked_schedule_ids: '[]',
    created_at: now,
    updated_at: now,
  })));
}

export function updateNoteItem(userId: string, id: string, updates: { content?: unknown; completed?: unknown }): NoteItem | undefined {
  const existing = db.getNoteItem(id, userId);
  if (!existing) return undefined;
  const patch: Parameters<typeof db.updateNoteItem>[2] = {};
  if (updates.content !== undefined) patch.content = validateContent(updates.content);
  if (updates.completed !== undefined) {
    if (typeof updates.completed !== 'boolean') throw new Error('完成状态不正确');
    patch.completed = updates.completed ? 1 : 0;
    patch.completed_at = updates.completed ? new Date().toISOString() : null;
  }
  if (!Object.keys(patch).length) return toNoteItem(existing);
  const updated = db.updateNoteItem(id, userId, patch);
  return updated ? toNoteItem(updated) : undefined;
}

export function completeNoteItemWithSchedules(userId: string, id: string, scheduleIds: string[]): NoteItem | undefined {
  const existing = db.getNoteItem(id, userId);
  if (!existing) return undefined;
  const links = [...new Set(scheduleIds.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 100);
  const existingLinks = parseLinkedScheduleIds(existing.linked_schedule_ids);
  const updated = db.updateNoteItem(id, userId, {
    completed: 1,
    completed_at: new Date().toISOString(),
    linked_schedule_ids: JSON.stringify([...new Set([...existingLinks, ...links])]),
  });
  return updated ? toNoteItem(updated) : undefined;
}

export function deleteNoteItem(userId: string, id: string): boolean {
  return db.deleteNoteItem(id, userId);
}

export function exportNoteItems(userId: string): NoteItem[] {
  return listNoteItems(userId);
}
