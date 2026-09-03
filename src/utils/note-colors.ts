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

export const NOTE_COLOR_STYLES: Record<NoteColor, {
  accent: string;
  surface: string;
  border: string;
}> = {
  neutral: { accent: '#64748b', surface: 'rgba(100, 116, 139, .08)', border: 'rgba(100, 116, 139, .28)' },
  purple: { accent: '#7c3aed', surface: 'rgba(124, 58, 237, .09)', border: 'rgba(124, 58, 237, .3)' },
  blue: { accent: '#2563eb', surface: 'rgba(37, 99, 235, .09)', border: 'rgba(37, 99, 235, .3)' },
  green: { accent: '#059669', surface: 'rgba(5, 150, 105, .09)', border: 'rgba(5, 150, 105, .3)' },
  amber: { accent: '#d97706', surface: 'rgba(217, 119, 6, .1)', border: 'rgba(217, 119, 6, .32)' },
  rose: { accent: '#e11d48', surface: 'rgba(225, 29, 72, .09)', border: 'rgba(225, 29, 72, .3)' },
};

export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === 'string' && (NOTE_COLORS as readonly string[]).includes(value);
}

export function normaliseNoteColor(value: unknown): NoteColor {
  return isNoteColor(value) ? value : 'neutral';
}
