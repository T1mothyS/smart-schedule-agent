import { NOTE_COLOR_LABELS, type NoteColor, normaliseNoteColor } from './note-colors';
import { formatNoteDateTime, noteDateKey, NOTE_TIME_ZONE_LABEL } from './note-time';

export type NoteExportSection = 'active' | 'trash';

export interface NoteExportItem {
  content: string;
  completed: boolean;
  color: NoteColor;
  updatedAt: string;
}

function sectionLabel(section: NoteExportSection): string {
  return section === 'trash' ? '废纸篓' : '进行中';
}

function normaliseLineBreaks(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\r\n');
}

function metadata(item: NoteExportItem, section: NoteExportSection): string[] {
  return [
    `颜色：${NOTE_COLOR_LABELS[normaliseNoteColor(item.color)]}`,
    `状态：${sectionLabel(section)}`,
    `更新时间：${formatNoteDateTime(item.updatedAt)}（${NOTE_TIME_ZONE_LABEL}）`,
  ];
}

export function formatNotesAsText(items: NoteExportItem[], section: NoteExportSection): string {
  const paragraphs = items.map((item, index) => [
    `${index + 1}. ${normaliseLineBreaks(item.content)}`,
    ...metadata(item, section),
  ].join('\r\n'));
  return '\uFEFF' + paragraphs.join('\r\n\r\n') + (paragraphs.length ? '\r\n' : '');
}

function csvCell(value: string | number): string {
  const normalised = String(value).replace(/\r\n|\r|\n/g, '\n');
  return `"${normalised.replace(/"/g, '""')}"`;
}

export function formatNotesAsCsv(items: NoteExportItem[], section: NoteExportSection): string {
  const rows = [
    ['编号', '内容', '颜色', '状态', '更新时间'],
    ...items.map((item, index) => [
      index + 1,
      item.content,
      NOTE_COLOR_LABELS[normaliseNoteColor(item.color)],
      sectionLabel(section),
      `${formatNoteDateTime(item.updatedAt)}（${NOTE_TIME_ZONE_LABEL}）`,
    ]),
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function noteExportFilename(section: NoteExportSection, date = new Date()): string {
  return `ai-notes-${section}-${noteDateKey(date)}`;
}
