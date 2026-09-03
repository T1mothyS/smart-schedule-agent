import { NOTE_COLOR_LABELS, type NoteColor, normaliseNoteColor } from './note-colors';

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
    `更新时间：${item.updatedAt}`,
  ];
}

export function formatNotesAsText(items: NoteExportItem[], section: NoteExportSection): string {
  const paragraphs = items.map((item, index) => [
    `${index + 1}. ${normaliseLineBreaks(item.content)}`,
    ...metadata(item, section),
  ].join('\r\n'));
  return '\uFEFF' + paragraphs.join('\r\n\r\n') + (paragraphs.length ? '\r\n' : '');
}

export function formatNotesAsMarkdown(items: NoteExportItem[], section: NoteExportSection): string {
  const title = section === 'trash' ? 'AI 记事｜废纸篓' : 'AI 记事｜进行中';
  const paragraphs = items.map((item, index) => [
    `## ${index + 1}. ${item.content.replace(/\r\n|\r|\n/g, ' ')}`,
    ...metadata(item, section).map(value => `- ${value}`),
  ].join('\n'));
  return [`# ${title}`, '', ...paragraphs.flatMap(value => [value, '', '---', ''])].join('\n').replace(/\n{3,}$/g, '\n\n');
}

export function noteExportFilename(section: NoteExportSection, date = new Date()): string {
  const dateKey = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return `ai-notes-${section}-${dateKey}`;
}
