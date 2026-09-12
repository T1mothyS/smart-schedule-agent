import * as activityStore from './activity-store.js';
import * as db from './db.js';
import * as scheduleStore from './schedule-store.js';

export const SEARCH_SCOPES = ['all', 'schedule', 'note', 'report', 'library'] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export interface SearchTarget {
  path: string;
}

export interface SearchResult {
  type: Exclude<SearchScope, 'all'>;
  id: string;
  title: string;
  snippet: string;
  date?: string;
  target: SearchTarget;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  counts: Record<Exclude<SearchScope, 'all'>, number>;
}

const MAX_QUERY_LENGTH = 120;
const MAX_LIMIT = 40;
const PER_SCOPE_LIMIT = 10;
const CANDIDATE_LIMIT = 100;

function normalizeScope(value: unknown): SearchScope {
  const scope = String(value || 'all');
  return (SEARCH_SCOPES as readonly string[]).includes(scope) ? scope as SearchScope : 'all';
}

function normalizeQuery(value: unknown): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

function plainText(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[#>*_`~-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function matchRank(query: string, fields: unknown[]): number {
  const normalizedQuery = query.toLocaleLowerCase();
  let best = 0;
  for (const field of fields) {
    const normalized = plainText(field).toLocaleLowerCase();
    if (!normalized) continue;
    if (normalized === normalizedQuery) best = Math.max(best, 100);
    else if (normalized.startsWith(normalizedQuery)) best = Math.max(best, 90);
    else if (normalized.includes(normalizedQuery)) best = Math.max(best, 60);
  }
  return best;
}

function makeSnippet(query: string, fields: unknown[], maxLength = 150): string {
  const source = fields.map(plainText).find(value => value) || '';
  if (!source) return '';
  const lowerSource = source.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const position = lowerSource.indexOf(lowerQuery);
  if (position < 0) return source.length > maxLength ? `${source.slice(0, maxLength - 1)}…` : source;
  const start = Math.max(0, position - 52);
  const end = Math.min(source.length, position + query.length + 84);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < source.length ? '…' : '';
  return `${prefix}${source.slice(start, end).trim()}${suffix}`;
}

function sortResults(results: Array<SearchResult & { rank: number }>): SearchResult[] {
  return results
    .sort((left, right) => right.rank - left.rank || String(right.date || '').localeCompare(String(left.date || '')) || right.id.localeCompare(left.id))
    .slice(0, PER_SCOPE_LIMIT)
    .map(({ rank: _rank, ...result }) => result);
}

function scheduleResults(userId: string, query: string): SearchResult[] {
  const rows = scheduleStore.searchSchedules(userId, query, CANDIDATE_LIMIT);
  const matches = rows.flatMap(schedule => {
    const date = schedule.start_time.slice(0, 10);
    const fields = [schedule.title, schedule.description, schedule.notes, schedule.location, schedule.category, date];
    const rank = matchRank(query, fields);
    if (!rank) return [];
    return [{
      type: 'schedule' as const,
      id: schedule.id,
      title: schedule.title || '未命名日程',
      snippet: makeSnippet(query, fields),
      date,
      target: { path: `/schedule?date=${encodeURIComponent(date)}&schedule=${encodeURIComponent(schedule.id)}` },
      metadata: {
        startTime: schedule.start_time,
        endTime: schedule.end_time || null,
        completed: schedule.is_completed,
        category: schedule.category,
        location: schedule.location || null,
      },
      rank,
    }];
  });
  return sortResults(matches);
}

function noteResults(userId: string, query: string): SearchResult[] {
  const rows = db.searchNoteItems(userId, query, CANDIDATE_LIMIT);
  const matches = rows.flatMap(note => {
    const fields = [note.content];
    const rank = matchRank(query, fields);
    if (!rank) return [];
    return [{
      type: 'note' as const,
      id: note.id,
      title: note.content.slice(0, 80) || '未命名记事',
      snippet: makeSnippet(query, fields),
      date: note.updated_at,
      target: { path: `/assistant?note=${encodeURIComponent(note.id)}` },
      metadata: { completed: note.completed === 1, color: note.color },
      rank,
    }];
  });
  return sortResults(matches);
}

function reportResults(userId: string, query: string): SearchResult[] {
  const rows = activityStore.searchDailyReports(userId, query, CANDIDATE_LIMIT);
  const matches = rows.flatMap(report => {
    const title = `日报 ${report.reportDate}`;
    const fields = [title, report.reportDate, report.markdown];
    const rank = matchRank(query, fields);
    if (!rank) return [];
    return [{
      type: 'report' as const,
      id: report.id,
      title,
      snippet: makeSnippet(query, [report.markdown, title]),
      date: report.reportDate,
      target: { path: `/reports/${encodeURIComponent(report.reportDate)}?source=${report.source}` },
      metadata: {
        updatedAt: report.updatedAt,
        contentHash: report.contentHash,
        source: report.source,
        deliveryStatus: report.deliveryStatus === 'candidate' ? 'CANDIDATE' : 'RECEIVED',
      },
      rank,
    }];
  });
  return sortResults(matches);
}

function libraryResults(userId: string, query: string): SearchResult[] {
  const rows = db.listLibraryEntries(userId, { q: query, status: 'active', limit: CANDIDATE_LIMIT, offset: 0 }).items;
  const matches = rows.flatMap(entry => {
    const tags = (() => {
      try { return JSON.parse(entry.tags_json) as string[]; } catch { return []; }
    })();
    const fields = [entry.title, entry.summary, entry.content, tags.join(' ')];
    const rank = matchRank(query, fields);
    if (!rank) return [];
    return [{
      type: 'library' as const,
      id: entry.id,
      title: entry.title || entry.summary || '未命名知识内容',
      snippet: makeSnippet(query, [entry.summary, entry.content]),
      date: entry.updated_at,
      target: { path: `/library/${encodeURIComponent(entry.id)}` },
      metadata: { kind: entry.kind, sourceType: entry.source_type, tags },
      rank,
    }];
  });
  return sortResults(matches);
}

export function searchAll(userId: string, input: { query?: unknown; scope?: unknown; limit?: unknown } = {}): SearchResponse {
  const query = normalizeQuery(input.query);
  const scope = normalizeScope(input.scope);
  const requestedLimit = Number(input.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_LIMIT)
    : MAX_LIMIT;
  const emptyCounts = { schedule: 0, note: 0, report: 0, library: 0 };
  if (!query) return { query, results: [], counts: emptyCounts };

  const scopedResults = {
    schedule: scope === 'all' || scope === 'schedule' ? scheduleResults(userId, query) : [],
    note: scope === 'all' || scope === 'note' ? noteResults(userId, query) : [],
    report: scope === 'all' || scope === 'report' ? reportResults(userId, query) : [],
    library: scope === 'all' || scope === 'library' ? libraryResults(userId, query) : [],
  };
  const results = (Object.values(scopedResults).flat() as SearchResult[]).slice(0, limit);
  return {
    query,
    results,
    counts: {
      schedule: scopedResults.schedule.length,
      note: scopedResults.note.length,
      report: scopedResults.report.length,
      library: scopedResults.library.length,
    },
  };
}
