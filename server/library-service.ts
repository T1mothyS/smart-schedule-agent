import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';
import { renderLibraryMarkdown } from './library-markdown.js';

export const LIBRARY_KINDS = ['fragment', 'article'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const LIBRARY_TYPES = ['knowledge', 'insight', 'framework', 'experience', 'tutorial', 'reference'] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];

export const LIBRARY_STATUSES = ['draft', 'active', 'archived'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const LIBRARY_SOURCE_TYPES = [
  'manual', 'calendar_event', 'daily_report', 'url', 'document', 'screenshot', 'api', 'codex', 'migration', 'fragment',
] as const;
export type LibrarySourceType = (typeof LIBRARY_SOURCE_TYPES)[number];

export const LIBRARY_CONTENT_MAX_BYTES = 800_000;
export const LIBRARY_TITLE_MAX_LENGTH = 240;
export const LIBRARY_SUMMARY_MAX_LENGTH = 1_000;
export const LIBRARY_TAG_MAX_LENGTH = 50;
export const LIBRARY_TAG_MAX_COUNT = 30;
export const LIBRARY_COMMENT_MAX_LENGTH = 2_000;

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
  relations: {
    calendarEvents: string[];
    libraryEntries: string[];
  };
}

export interface LibraryMutationResult {
  status: 'CREATED' | 'UPDATED' | 'UNCHANGED';
  entry: LibraryEntry;
  normalizedFields: string[];
  warnings: string[];
}

export class LibraryInputError extends Error {
  code: string;
  field?: string;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'LibraryInputError';
    this.code = code;
    this.field = field;
  }
}

interface EntryInput {
  kind?: unknown;
  type?: unknown;
  sourceId?: unknown;
  externalId?: unknown;
  slug?: unknown;
  title?: unknown;
  content?: unknown;
  summary?: unknown;
  tags?: unknown;
  status?: unknown;
  sourceType?: unknown;
  sourceRef?: unknown;
  sourceUrl?: unknown;
  metadata?: unknown;
}

interface NormalizedEntryInput {
  kind: LibraryKind;
  type: LibraryType;
  sourceId: string | null;
  slug: string | null;
  title: string | null;
  content: string;
  summary: string;
  tags: string[];
  status: LibraryStatus;
  sourceType: string;
  sourceRef: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  normalizedFields: string[];
  warnings: string[];
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, field: string, fallback?: T[number]): T[number] {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new LibraryInputError('MISSING_FIELD', `${field} 不能为空`, field);
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new LibraryInputError('INVALID_VALUE', `${field} 不合法`, field);
  }
  return value as T[number];
}

function boundedString(value: unknown, field: string, maxLength: number, options: { required?: boolean } = {}): string | null {
  const text = String(value ?? '').trim();
  if (!text) {
    if (options.required) throw new LibraryInputError('MISSING_FIELD', `${field} 不能为空`, field);
    return null;
  }
  if (text.length > maxLength) throw new LibraryInputError('CONTENT_TOO_LONG', `${field} 不能超过 ${maxLength} 个字符`, field);
  return text;
}

function normaliseContent(value: unknown): { content: string; changed: boolean } {
  if (typeof value !== 'string') throw new LibraryInputError('MISSING_FIELD', 'content 不能为空', 'content');
  const content = value.replace(/\r\n?/g, '\n').trim();
  if (!content) throw new LibraryInputError('MISSING_FIELD', 'content 不能为空', 'content');
  if (Buffer.byteLength(content, 'utf8') > LIBRARY_CONTENT_MAX_BYTES) {
    throw new LibraryInputError('CONTENT_TOO_LONG', `content 不能超过 ${LIBRARY_CONTENT_MAX_BYTES} 字节`, 'content');
  }
  return { content, changed: content !== value };
}

function normaliseTags(value: unknown): { tags: string[]; changed: boolean } {
  let source: unknown = value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      source = Array.isArray(parsed) ? parsed : value.split(/[,，]/);
    } catch {
      source = value.split(/[,，]/);
    }
  }
  if (source === undefined || source === null) return { tags: [], changed: false };
  if (!Array.isArray(source)) throw new LibraryInputError('INVALID_VALUE', 'tags 必须是字符串数组', 'tags');
  const raw = source.map(item => String(item ?? '').trim()).filter(Boolean);
  if (raw.length > LIBRARY_TAG_MAX_COUNT) throw new LibraryInputError('TOO_MANY_TAGS', `tags 最多 ${LIBRARY_TAG_MAX_COUNT} 个`, 'tags');
  if (raw.some(tag => tag.length > LIBRARY_TAG_MAX_LENGTH)) throw new LibraryInputError('TAG_TOO_LONG', `单个标签不能超过 ${LIBRARY_TAG_MAX_LENGTH} 个字符`, 'tags');
  const tags = [...new Set(raw)];
  return { tags, changed: tags.length !== raw.length || tags.some((tag, index) => tag !== source[index]) || tags.length !== source.length };
}

function normaliseMetadata(value: unknown): { metadata: Record<string, unknown>; changed: boolean } {
  if (value === undefined || value === null) return { metadata: {}, changed: false };
  if (typeof value !== 'object' || Array.isArray(value)) throw new LibraryInputError('INVALID_VALUE', 'metadata 必须是 JSON 对象', 'metadata');
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new LibraryInputError('INVALID_VALUE', 'metadata 不是有效 JSON', 'metadata');
  }
  if (Buffer.byteLength(serialized, 'utf8') > 40_000) throw new LibraryInputError('CONTENT_TOO_LONG', 'metadata 不能超过 40000 字节', 'metadata');
  return { metadata: value as Record<string, unknown>, changed: false };
}

function validateSourceUrl(value: unknown): string | null {
  const url = boundedString(value, 'sourceUrl', 2_000);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
  } catch {
    throw new LibraryInputError('INVALID_SOURCE_URL', 'sourceUrl 只允许 http 或 https 地址', 'sourceUrl');
  }
  return url;
}

function summarizeContent(content: string): string {
  const plain = content
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[|#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 180 ? `${plain.slice(0, 180).trim()}…` : plain;
}

function makeSlug(title: string | null, id: string): string {
  const latin = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return latin || `entry-${id.slice(0, 12)}`;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toEntry(row: db.DbLibraryEntry, includeContent = false): LibraryEntry {
  const tags = parseJson<unknown[]>(row.tags_json, []).filter(item => typeof item === 'string') as string[];
  const metadataValue = parseJson<unknown>(row.metadata_json, {});
  const metadata = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
    ? metadataValue as Record<string, unknown>
    : {};
  return {
    id: row.id,
    kind: row.kind,
    type: row.type,
    sourceId: row.source_id,
    slug: row.slug,
    title: row.title,
    ...(includeContent ? { content: row.content, html: renderLibraryMarkdown(row.content) } : {}),
    summary: row.summary,
    tags,
    status: row.status,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceUrl: row.source_url,
    metadata,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
  };
}

function toVersion(row: db.DbLibraryEntryVersion): LibraryVersion {
  return {
    id: row.id,
    entryId: row.entry_id,
    contentHash: row.content_hash,
    title: row.title,
    summary: row.summary,
    content: row.content,
    tags: parseJson<unknown[]>(row.tags_json, []).filter(item => typeof item === 'string') as string[],
    createdAt: row.created_at,
  };
}

function toComment(row: db.DbLibraryComment): LibraryComment {
  return {
    id: row.id,
    entryId: row.entry_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normaliseInput(input: EntryInput, options: {
  id: string;
  existing?: db.DbLibraryEntry;
  forceKind?: LibraryKind;
  forceStatus?: LibraryStatus;
  requireSourceId?: boolean;
}): NormalizedEntryInput {
  const existing = options.existing;
  const normalizedFields: string[] = [];
  const warnings: string[] = [];
  const kind = options.forceKind || enumValue(input.kind ?? existing?.kind, LIBRARY_KINDS, 'kind', 'fragment');
  const type = enumValue(input.type ?? existing?.type, LIBRARY_TYPES, 'type', 'knowledge');
  const sourceIdRaw = input.sourceId ?? input.externalId ?? existing?.source_id;
  const sourceId = boundedString(sourceIdRaw, 'sourceId', 240);
  if (options.requireSourceId && !sourceId) throw new LibraryInputError('MISSING_FIELD', '正式知识发布必须提供 sourceId', 'sourceId');
  const title = boundedString(input.title !== undefined ? input.title : existing?.title, 'title', LIBRARY_TITLE_MAX_LENGTH, { required: kind === 'article' });
  if (kind === 'article' && !title) throw new LibraryInputError('MISSING_FIELD', 'article 必须有 title', 'title');
  const contentValue = input.content !== undefined ? input.content : existing?.content;
  const contentResult = normaliseContent(contentValue);
  if (contentResult.changed) normalizedFields.push('content');
  const summaryInput = input.summary !== undefined ? input.summary : existing?.summary;
  let summary = boundedString(summaryInput, 'summary', LIBRARY_SUMMARY_MAX_LENGTH) || '';
  if (!summary) {
    summary = summarizeContent(contentResult.content);
    if (summary) warnings.push('summary_generated');
  }
  const tagsInput = input.tags !== undefined ? input.tags : existing ? parseJson(existing.tags_json, []) : [];
  const tagResult = normaliseTags(tagsInput);
  if (tagResult.changed) normalizedFields.push('tags');
  const defaultStatus: LibraryStatus = kind === 'article' ? 'draft' : 'active';
  const status = options.forceStatus || enumValue(input.status ?? existing?.status, LIBRARY_STATUSES, 'status', defaultStatus);
  const sourceTypeValue = input.sourceType ?? existing?.source_type ?? 'manual';
  const sourceType = boundedString(sourceTypeValue, 'sourceType', 80) || 'manual';
  if (!LIBRARY_SOURCE_TYPES.includes(sourceType as LibrarySourceType)) {
    throw new LibraryInputError('INVALID_SOURCE_TYPE', `sourceType 不支持：${sourceType}`, 'sourceType');
  }
  const sourceRef = boundedString(input.sourceRef !== undefined ? input.sourceRef : existing?.source_ref, 'sourceRef', 2_000);
  const sourceUrl = validateSourceUrl(input.sourceUrl !== undefined ? input.sourceUrl : existing?.source_url);
  const metadataResult = normaliseMetadata(input.metadata !== undefined ? input.metadata : existing ? parseJson(existing.metadata_json, {}) : {});
  const slug = boundedString(input.slug !== undefined ? input.slug : existing?.slug, 'slug', 120) || makeSlug(title, options.id);
  const normalized = {
    kind,
    type,
    sourceId,
    slug,
    title,
    content: contentResult.content,
    summary,
    tags: tagResult.tags,
    status,
    sourceType,
    sourceRef,
    sourceUrl,
    metadata: metadataResult.metadata,
    normalizedFields,
    warnings,
  } satisfies NormalizedEntryInput;
  if (title && input.title !== undefined && String(input.title).trim() !== title) normalizedFields.push('title');
  if (sourceId && input.sourceId !== undefined && String(input.sourceId).trim() !== sourceId) normalizedFields.push('sourceId');
  return normalized;
}

function entryFromNormalized(userId: string, id: string, input: NormalizedEntryInput, now: string, existing?: db.DbLibraryEntry): db.DbLibraryEntry {
  const publishedAt = input.kind === 'article' && input.status === 'active'
    ? existing?.published_at || now
    : existing?.published_at || null;
  return {
    id,
    user_id: userId,
    kind: input.kind,
    type: input.type,
    source_id: input.sourceId,
    slug: input.slug,
    title: input.title,
    content: input.content,
    summary: input.summary,
    tags_json: JSON.stringify(input.tags),
    status: input.status,
    source_type: input.sourceType,
    source_ref: input.sourceRef,
    source_url: input.sourceUrl,
    metadata_json: JSON.stringify(input.metadata),
    content_hash: crypto.createHash('sha256').update(input.content, 'utf8').digest('hex'),
    created_at: existing?.created_at || now,
    updated_at: now,
    published_at: publishedAt,
    archived_at: input.status === 'archived' ? existing?.archived_at || now : null,
  };
}

function saveArticleVersion(entry: db.DbLibraryEntry, now: string): void {
  db.createLibraryEntryVersion({
    id: uuidv4(),
    entry_id: entry.id,
    user_id: entry.user_id,
    content_hash: entry.content_hash,
    title: entry.title,
    summary: entry.summary,
    content: entry.content,
    tags_json: entry.tags_json,
    created_at: now,
  });
}

export function listLibraryEntries(userId: string, filters: {
  q?: string;
  kind?: string;
  type?: string;
  status?: string;
  tag?: string;
  sourceType?: string;
  page?: number;
  pageSize?: number;
  sort?: 'updated_desc' | 'created_desc';
} = {}): { items: LibraryEntry[]; total: number; page: number; pageSize: number } {
  const page = Math.max(Math.floor(filters.page || 1), 1);
  const pageSize = Math.min(Math.max(Math.floor(filters.pageSize || 40), 1), 100);
  const result = db.listLibraryEntries(userId, {
    q: filters.q,
    kind: filters.kind,
    type: filters.type,
    status: filters.status || 'active',
    tag: filters.tag,
    source_type: filters.sourceType,
    sort: filters.sort,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return { items: result.items.map(row => toEntry(row)), total: result.total, page, pageSize };
}

export function exportUserLibraryEntries(userId: string): LibraryEntry[] {
  return db.exportUserLibraryEntries(userId).map(row => toEntry(row, true));
}

export function getLibraryDetail(userId: string, id: string): LibraryDetail | undefined {
  const entry = db.getLibraryEntry(id, userId);
  if (!entry) return undefined;
  return {
    entry: toEntry(entry, true),
    versions: db.listLibraryEntryVersions(id, userId).map(toVersion),
    comments: db.listLibraryComments(id, userId).map(toComment),
    relations: { calendarEvents: [], libraryEntries: [] },
  };
}

export function createLibraryEntry(userId: string, input: EntryInput): LibraryMutationResult {
  const id = uuidv4();
  const normalized = normaliseInput(input, { id });
  if (normalized.sourceId && db.getLibraryEntryBySourceId(normalized.sourceId, userId)) {
    throw new LibraryInputError('DUPLICATE_SOURCE_ID', 'sourceId 已经对应现有内容', 'sourceId');
  }
  const now = new Date().toISOString();
  const row = db.createLibraryEntry(entryFromNormalized(userId, id, normalized, now));
  if (row.kind === 'article') saveArticleVersion(row, now);
  return { status: 'CREATED', entry: toEntry(row, true), normalizedFields: normalized.normalizedFields, warnings: normalized.warnings };
}

export function updateLibraryEntry(userId: string, id: string, input: EntryInput): LibraryMutationResult | undefined {
  const existing = db.getLibraryEntry(id, userId);
  if (!existing) return undefined;
  const normalized = normaliseInput({ ...input, kind: existing.kind }, { id, existing, forceKind: existing.kind });
  if (normalized.sourceId && normalized.sourceId !== existing.source_id) {
    const duplicate = db.getLibraryEntryBySourceId(normalized.sourceId, userId);
    if (duplicate && duplicate.id !== id) throw new LibraryInputError('DUPLICATE_SOURCE_ID', 'sourceId 已经对应现有内容', 'sourceId');
  }
  const candidate = entryFromNormalized(userId, id, normalized, new Date().toISOString(), existing);
  const unchanged = [
    'kind', 'type', 'source_id', 'slug', 'title', 'content', 'summary', 'tags_json', 'status', 'source_type',
    'source_ref', 'source_url', 'metadata_json', 'content_hash', 'published_at', 'archived_at',
  ].every(field => String(candidate[field as keyof db.DbLibraryEntry] ?? '') === String(existing[field as keyof db.DbLibraryEntry] ?? ''));
  if (unchanged) return { status: 'UNCHANGED', entry: toEntry(existing, true), normalizedFields: normalized.normalizedFields, warnings: normalized.warnings };
  const updated = db.updateLibraryEntry(id, userId, {
    kind: candidate.kind,
    type: candidate.type,
    source_id: candidate.source_id,
    slug: candidate.slug,
    title: candidate.title,
    content: candidate.content,
    summary: candidate.summary,
    tags_json: candidate.tags_json,
    status: candidate.status,
    source_type: candidate.source_type,
    source_ref: candidate.source_ref,
    source_url: candidate.source_url,
    metadata_json: candidate.metadata_json,
    content_hash: candidate.content_hash,
    updated_at: candidate.updated_at,
    published_at: candidate.published_at,
    archived_at: candidate.archived_at,
  })!;
  const articleVersionChanged = updated.kind === 'article' && (
    updated.content_hash !== existing.content_hash
    || updated.title !== existing.title
    || updated.summary !== existing.summary
    || updated.tags_json !== existing.tags_json
  );
  if (articleVersionChanged) saveArticleVersion(updated, updated.updated_at);
  return { status: 'UPDATED', entry: toEntry(updated, true), normalizedFields: normalized.normalizedFields, warnings: normalized.warnings };
}

export function publishLibraryArticle(userId: string, input: EntryInput): LibraryMutationResult {
  const sourceId = input.sourceId ?? input.externalId;
  if (!sourceId) throw new LibraryInputError('MISSING_FIELD', '正式知识发布必须提供 sourceId', 'sourceId');
  const existing = db.getLibraryEntryBySourceId(String(sourceId).trim(), userId);
  if (existing && existing.kind !== 'article') {
    throw new LibraryInputError('SOURCE_KIND_CONFLICT', 'sourceId 已经对应知识碎片，不能覆盖为正式知识', 'sourceId');
  }
  const normalizedInput: EntryInput = { ...input, kind: 'article', status: 'active', sourceId };
  if (!existing) return createLibraryEntry(userId, normalizedInput);
  return updateLibraryEntry(userId, existing.id, normalizedInput)!;
}

export function archiveLibraryEntry(userId: string, id: string): LibraryEntry | undefined {
  const existing = db.getLibraryEntry(id, userId);
  if (!existing) return undefined;
  const updated = db.updateLibraryEntry(id, userId, {
    status: 'archived',
    archived_at: existing.archived_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return updated ? toEntry(updated, true) : undefined;
}

export function deleteLibraryEntry(userId: string, id: string): boolean {
  return db.deleteLibraryEntry(id, userId);
}

export function promoteFragmentToArticle(userId: string, id: string): LibraryMutationResult | undefined {
  const fragment = db.getLibraryEntry(id, userId);
  if (!fragment) return undefined;
  if (fragment.kind !== 'fragment') throw new LibraryInputError('INVALID_KIND', '只有知识碎片可以整理为正式知识', 'id');
  return createLibraryEntry(userId, {
    kind: 'article',
    type: fragment.type,
    title: fragment.title || summarizeContent(fragment.content),
    content: fragment.content,
    summary: fragment.summary,
    tags: parseJson(fragment.tags_json, []),
    sourceType: 'fragment',
    sourceRef: fragment.id,
    status: 'draft',
  });
}

export function addLibraryComment(userId: string, entryId: string, value: unknown): LibraryComment | undefined {
  if (!db.getLibraryEntry(entryId, userId)) return undefined;
  const content = boundedString(value, 'content', LIBRARY_COMMENT_MAX_LENGTH, { required: true });
  const now = new Date().toISOString();
  return toComment(db.createLibraryComment({
    id: uuidv4(),
    entry_id: entryId,
    user_id: userId,
    content: content!,
    created_at: now,
    updated_at: now,
  }));
}

export function deleteLibraryComment(userId: string, entryId: string, commentId: string): boolean {
  return db.deleteLibraryComment(commentId, entryId, userId);
}

export function exportLibraryEntryMarkdown(userId: string, id: string): { filename: string; markdown: string } | undefined {
  const entry = db.getLibraryEntry(id, userId);
  if (!entry) return undefined;
  const tags = parseJson<unknown[]>(entry.tags_json, []).filter(item => typeof item === 'string') as string[];
  const frontmatter = [
    '---',
    `id: ${entry.id}`,
    `sourceId: ${JSON.stringify(entry.source_id || '')}`,
    `kind: ${entry.kind}`,
    `type: ${entry.type}`,
    `title: ${JSON.stringify(entry.title || '')}`,
    `summary: ${JSON.stringify(entry.summary)}`,
    `tags: ${JSON.stringify(tags)}`,
    `sourceType: ${entry.source_type}`,
    `sourceRef: ${JSON.stringify(entry.source_ref || '')}`,
    `sourceUrl: ${JSON.stringify(entry.source_url || '')}`,
    `status: ${entry.status}`,
    `updatedAt: ${entry.updated_at}`,
    '---',
    '',
  ].join('\n');
  const safeFilename = (entry.title || entry.slug || entry.id).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100) || entry.id;
  return { filename: `${safeFilename}.md`, markdown: frontmatter + entry.content.trimEnd() + '\n' };
}
