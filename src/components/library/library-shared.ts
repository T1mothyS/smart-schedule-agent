export type LibraryKind = 'fragment' | 'article';

export type LibraryType = 'knowledge' | 'insight' | 'framework' | 'experience' | 'tutorial' | 'reference';

export type LibraryStatus = 'draft' | 'active' | 'archived';

export type RelationStatus = 'confirmed' | 'suggested' | 'unresolved';

export type LibrarySort = 'title_asc' | 'title_desc' | 'updated_asc' | 'updated_desc' | 'created_asc' | 'created_desc';

export const DEFAULT_LIBRARY_SORT: LibrarySort = 'created_desc';

export interface LibraryRelation {
  sourceId: string;
  targetSourceId: string;
  type: string;
  label: string;
  status: RelationStatus;
  targetEntryId?: string;
  targetTitle?: string;
  targetStatus?: LibraryStatus;
}

export interface LibraryEntry {
  id: string;
  kind: LibraryKind;
  type: LibraryType;
  sourceId: string | null;
  slug: string | null;
  title: string | null;
  content?: string;
  html?: string;
  summary: string;
  tags: string[];
  status: LibraryStatus;
  sourceType: string;
  sourceRef: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  relations: LibraryRelation[];
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
}

export interface LibraryVersion {
  id: string;
  entryId: string;
  contentHash: string;
  title: string | null;
  summary: string;
  content: string;
  tags: string[];
  relations: LibraryRelation[];
  createdAt: string;
}

export interface LibraryComment {
  id: string;
  entryId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryDetail {
  entry: LibraryEntry;
  versions: LibraryVersion[];
  comments: LibraryComment[];
  relations: { items: LibraryRelation[]; calendarEvents: string[]; libraryEntries: string[] };
}

export const typeLabels: Record<LibraryType, string> = {
  knowledge: '知识',
  insight: '认知',
  framework: '框架',
  experience: '经历',
  tutorial: '教程',
  reference: '速查',
};

export const kindLabels: Record<LibraryKind, string> = { fragment: '知识碎片', article: '正式知识' };

export const statusLabels: Record<LibraryStatus, string> = { draft: '草稿', active: '有效', archived: '已归档' };

export const relationStatusLabels: Record<RelationStatus, string> = { confirmed: '已确认', suggested: '待确认', unresolved: '未解析' };

export const sortLabels: Record<LibrarySort, string> = {
  title_asc: '名称正序',
  title_desc: '名称倒序',
  updated_desc: '修改时间倒序',
  updated_asc: '修改时间正序',
  created_desc: '创建时间倒序',
  created_asc: '创建时间正序',
};

export function isLibrarySort(value: unknown): value is LibrarySort {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(sortLabels, value);
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json();
    const message = data?.error?.message || data?.error || fallback;
    return new Error(String(message));
  } catch {
    return new Error(fallback);
  }
}

export async function downloadResponse(response: Response, fallbackName: string): Promise<void> {
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : fallbackName;
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to a temporary textarea when clipboard permission is unavailable.
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  textarea.remove();
  return copied;
}

export function richContentSource(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.library-rich-content-source');
}

export function showRichContentError(host: HTMLElement, sourceElement: HTMLElement, message: string, errorClass: string): void {
  sourceElement.hidden = false;
  const error = document.createElement('span');
  error.className = `library-rich-content-error ${errorClass}`;
  error.textContent = message;
  host.replaceChildren(error, sourceElement);
}

export function relationItems(detail: LibraryDetail): LibraryRelation[] {
  return detail.relations?.items || detail.entry.relations || [];
}

export interface LibraryTocItem {
  id: string;
  title: string;
  level: number;
}

export function normaliseHeadingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function headingAnchorBase(value: string, index: number): string {
  const slug = value
    .toLocaleLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/^-+|-+$/g, '');
  return `library-section-${slug || index + 1}`;
}

export function buildLibraryToc(root: HTMLElement, entryTitle: string): LibraryTocItem[] {
  const titleKey = normaliseHeadingText(entryTitle);
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
  const candidates: Array<{ heading: HTMLElement; title: string; level: number; index: number }> = [];

  headings.forEach((heading, index) => {
    const title = normaliseHeadingText(heading.textContent || '');
    if (!title) return;
    if (index === 0 && titleKey && title === titleKey) return;
    candidates.push({ heading, title, level: Number(heading.tagName.slice(1)), index });
  });

  const selectedLevels = Array.from(new Set(candidates.map(item => item.level))).sort((a, b) => a - b).slice(0, 2);
  if (!selectedLevels.length) return [];

  const usedIds = new Set(Array.from(root.querySelectorAll<HTMLElement>('[id]')).map(element => element.id));
  return candidates
    .filter(item => selectedLevels.includes(item.level))
    .map(item => {
      const base = headingAnchorBase(item.title, item.index);
      let id = base;
      let suffix = 2;
      while (usedIds.has(id)) id = `${base}-${suffix++}`;
      usedIds.add(id);
      item.heading.id = id;
      return { id, title: item.title, level: item.level };
    });
}
