import assert from 'node:assert/strict';
import test from 'node:test';
import { formatNotesAsMarkdown, formatNotesAsText, noteExportFilename } from '../src/utils/note-export.js';
import { formatNoteDateTime, noteDateKey } from '../src/utils/note-time.js';

const items = [
  { content: '第一条\n包含第二行', completed: false, color: 'purple' as const, updatedAt: '2026-09-03T12:34:56.000Z' },
  { content: '第二条', completed: false, color: 'neutral' as const, updatedAt: '2026-09-02T08:00:00.000Z' },
];

test('TXT 导出使用 UTF-8 BOM、Windows 换行、显示编号和基础元数据', () => {
  const output = formatNotesAsText(items, 'active');
  assert.ok(output.startsWith('\uFEFF'));
  assert.match(output, /1\. 第一条\r\n包含第二行/);
  assert.match(output, /颜色：紫色\r\n状态：进行中\r\n更新时间：2026-09-03 20:34（北京时间）/);
  assert.ok(output.indexOf('1. 第一条') < output.indexOf('2. 第二条'));
  assert.match(output, /\r\n\r\n/);
  assert.doesNotMatch(output, /legacy|内部 ID/i);
});

test('Markdown 导出按当前顺序生成标题、元数据和分隔线', () => {
  const output = formatNotesAsMarkdown(items, 'trash');
  assert.match(output, /^# AI 记事｜废纸篓/);
  assert.match(output, /## 1\. 第一条 包含第二行/);
  assert.match(output, /- 颜色：紫色\n- 状态：废纸篓/);
  assert.ok(output.includes('\n---\n'));
  assert.ok(output.indexOf('## 1.') < output.indexOf('## 2.'));
});

test('导出文件名区分分区和日期，不包含内部 ID', () => {
  const date = new Date('2026-09-03T15:59:00.000Z');
  assert.equal(noteExportFilename('active', date), 'ai-notes-active-2026-09-03');
  assert.equal(noteExportFilename('trash', date), 'ai-notes-trash-2026-09-03');
});

test('记事时间和导出日期固定按 Asia/Shanghai 显示', () => {
  assert.equal(formatNoteDateTime('2026-09-03T04:35:00.000Z'), '2026-09-03 12:35');
  assert.equal(noteDateKey(new Date('2026-09-03T16:30:00.000Z')), '2026-09-04');
});
