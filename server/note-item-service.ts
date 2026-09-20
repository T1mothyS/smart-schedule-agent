import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

export const NOTE_CONTENT_MAX_LENGTH = 2_000;
export const NOTE_BATCH_MAX = 100;
export const NOTE_BATCH_TOTAL_MAX_LENGTH = 20_000;
export const NOTE_COLORS = ['neutral', 'purple', 'blue', 'green', 'amber', 'rose'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  neutral: '中性灰',
  purple: '紫色',
  blue: '蓝色',
  green: '绿色',
  amber: '琥珀色',
  rose: '玫瑰色',
};

export interface NoteItem {
  id: string;
  content: string;
  isOptimized: boolean;
  optimizationCount: number;
  contentRevision: number;
  completed: boolean;
  completedAt: string | null;
  color: NoteColor;
  /** @deprecated 仅为历史 API/备份兼容保留，不再用于新的业务行为。 */
  linkedScheduleIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MergedNoteItems {
  source: NoteItem;
  target: NoteItem;
}

export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === 'string' && (NOTE_COLORS as readonly string[]).includes(value);
}

function validateColor(value: unknown): NoteColor {
  if (!isNoteColor(value)) throw new Error('记事颜色不正确，只允许 neutral、purple、blue、green、amber 或 rose');
  return value;
}

function normaliseColor(value: unknown): NoteColor {
  return isNoteColor(value) ? value : 'neutral';
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
    isOptimized: row.is_optimized === 1,
    optimizationCount: Number.isInteger(Number(row.optimization_count)) && Number(row.optimization_count) >= 0 ? Number(row.optimization_count) : 0,
    contentRevision: Number.isInteger(Number(row.content_revision)) && Number(row.content_revision) >= 0 ? Number(row.content_revision) : 0,
    completed: row.completed === 1,
    completedAt: row.completed_at || null,
    color: normaliseColor(row.color),
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

export function createNoteItems(userId: string, contents: unknown, color: unknown = 'neutral'): NoteItem[] {
  const values = normaliseNoteContents(contents);
  if (values.length > NOTE_BATCH_MAX) throw new Error(`一次最多保存 ${NOTE_BATCH_MAX} 条记事`);
  const validated = values.map(validateContent);
  const noteColor = validateColor(color);
  const totalLength = validated.reduce((sum, value) => sum + value.length, 0);
  if (totalLength > NOTE_BATCH_TOTAL_MAX_LENGTH) throw new Error(`一次保存的记事总长度不能超过 ${NOTE_BATCH_TOTAL_MAX_LENGTH} 个字符`);
  const now = new Date().toISOString();
  return validated.map(content => toNoteItem(db.createNoteItem({
    id: uuidv4(),
    user_id: userId,
    content,
    is_optimized: 0,
    optimization_count: 0,
    optimization_previous_content: null,
    content_revision: 0,
    completed: 0,
    completed_at: null,
    color: noteColor,
    linked_schedule_ids: '[]',
    created_at: now,
    updated_at: now,
  })));
}

export function updateNoteItem(userId: string, id: string, updates: { expectedContent?: unknown; expectedRevision?: unknown; content?: unknown; completed?: unknown; color?: unknown }): NoteItem | undefined {
  const existing = db.getNoteItem(id, userId);
  if (!existing) return undefined;
  if (updates.expectedContent !== undefined && updates.expectedContent !== existing.content) throw new NoteContentConflict();
  if (updates.expectedRevision !== undefined && updates.expectedRevision !== existing.content_revision) throw new NoteContentConflict();
  const patch: Parameters<typeof db.updateNoteItem>[2] = {};
  if (updates.content !== undefined) {
    patch.content = validateContent(updates.content);
    patch.is_optimized = 0;
    patch.optimization_previous_content = null;
    patch.content_revision = existing.content_revision + 1;
  }
  if (updates.color !== undefined) patch.color = validateColor(updates.color);
  if (updates.completed !== undefined) {
    if (typeof updates.completed !== 'boolean') throw new Error('完成状态不正确');
    patch.completed = updates.completed ? 1 : 0;
    patch.completed_at = updates.completed ? new Date().toISOString() : null;
  }
  if (!Object.keys(patch).length) return toNoteItem(existing);
  const updated = db.updateNoteItem(id, userId, patch, {
    content: updates.content !== undefined ? existing.content : undefined,
    contentRevision: updates.content !== undefined ? existing.content_revision : undefined,
  });
  if (!updated && updates.content !== undefined) throw new NoteContentConflict();
  return updated ? toNoteItem(updated) : undefined;
}

export function commitOptimizedNote(userId: string, id: string, expectedContent: string, expectedRevision: number, optimizedContent: unknown): NoteItem | undefined {
  const existing = db.getNoteItem(id, userId);
  if (!existing) return undefined;
  assertExpectedNoteVersion(existing, expectedContent, expectedRevision);
  if (existing.is_optimized === 1) throw new NoteOptimizationConflict('ALREADY_OPTIMIZED', '这条记事已经优化，请先撤回后再优化。');
  const content = validateContent(optimizedContent);
  const updated = db.commitNoteOptimization(id, userId, expectedContent, expectedRevision, content);
  if (!updated) throw new NoteContentConflict();
  return toNoteItem(updated);
}

export function revertOptimizedNote(userId: string, id: string, expectedContent: string, expectedRevision: number): NoteItem | undefined {
  const existing = db.getNoteItem(id, userId);
  if (!existing) return undefined;
  assertExpectedNoteVersion(existing, expectedContent, expectedRevision);
  if (existing.is_optimized !== 1 || !existing.optimization_previous_content) {
    throw new NoteOptimizationConflict('NOT_OPTIMIZED', '这条记事当前没有可撤回的优化结果。');
  }
  const updated = db.revertNoteOptimization(id, userId, expectedContent, expectedRevision);
  if (!updated) throw new NoteContentConflict();
  return toNoteItem(updated);
}

export function mergeNoteItems(userId: string, sourceId: string, targetId: string): MergedNoteItems | undefined {
  if (sourceId === targetId) throw new Error('来源记事和目标记事不能相同');
  const source = db.getNoteItem(sourceId, userId);
  const target = db.getNoteItem(targetId, userId);
  if (!source || !target) return undefined;

  const mergedContent = `${target.content}\n${source.content}`;
  if (mergedContent.length > NOTE_CONTENT_MAX_LENGTH) {
    throw new Error(`合并后的记事不能超过 ${NOTE_CONTENT_MAX_LENGTH.toLocaleString('en-US')} 个字符`);
  }

  const completedAt = new Date().toISOString();
  const merged = db.mergeNoteItems(sourceId, userId, targetId, mergedContent, completedAt);
  if (!merged) return undefined;
  return {
    source: toNoteItem(merged.source),
    target: toNoteItem(merged.target),
  };
}

export function deleteNoteItem(userId: string, id: string): boolean {
  return db.deleteNoteItem(id, userId);
}

export function exportNoteItems(userId: string): NoteItem[] {
  return listNoteItems(userId);
}

export class NoteContentConflict extends Error {
  constructor() { super("原文已变化，请重新打开最新记事后优化；当前结果仍可复制。"); }
}

type NoteOptimizationConflictCode = 'ALREADY_OPTIMIZED' | 'NOT_OPTIMIZED';

export class NoteOptimizationConflict extends Error {
  constructor(public readonly code: NoteOptimizationConflictCode, message: string) { super(message); }
}

function assertExpectedNoteVersion(row: db.DbNoteItem, expectedContent: string, expectedRevision: number): void {
  if (row.content !== expectedContent || row.content_revision !== expectedRevision) throw new NoteContentConflict();
}
