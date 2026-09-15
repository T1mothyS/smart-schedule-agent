import { queryAll, queryOne, run, executeWithoutSave, runTransaction } from '../connection.js';
import { escapeLike } from './search-utils.js';
import type { DbLibraryEntry, DbLibraryPreference, DbLibraryEntryVersion, DbLibraryComment, DbLibraryPublishToken, DbLibraryListFilters, LibraryLifecycleAction, LibraryLifecycleResult } from '../types.js';
import crypto from 'node:crypto';

export function getLibraryPreference(userId: string): DbLibraryPreference | undefined {
  return queryOne<DbLibraryPreference>('SELECT user_id, sort, updated_at FROM library_preferences WHERE user_id = ?', [userId]);
}

export function upsertLibraryPreference(preference: DbLibraryPreference): DbLibraryPreference {
  const existing = getLibraryPreference(preference.user_id);
  if (existing) {
    run(
      'UPDATE library_preferences SET sort = ?, updated_at = ? WHERE user_id = ?',
      [preference.sort, preference.updated_at, preference.user_id],
    );
  } else {
    run(
      'INSERT INTO library_preferences (user_id, sort, updated_at) VALUES (?, ?, ?)',
      [preference.user_id, preference.sort, preference.updated_at],
    );
  }
  return getLibraryPreference(preference.user_id) || preference;
}

export function getLibraryEntry(id: string, userId: string): DbLibraryEntry | undefined {
  return queryOne<DbLibraryEntry>('SELECT * FROM library_entries WHERE id = ? AND user_id = ?', [id, userId]);
}

export function getLibraryEntryBySourceId(sourceId: string, userId: string): DbLibraryEntry | undefined {
  return queryOne<DbLibraryEntry>(
    'SELECT * FROM library_entries WHERE source_id = ? AND user_id = ? LIMIT 1',
    [sourceId, userId],
  );
}

export function listLibraryEntries(userId: string, filters: DbLibraryListFilters = {}): { items: DbLibraryEntry[]; total: number } {
  const clauses = ['user_id = ?'];
  const params: any[] = [userId];
  if (filters.kind && filters.kind !== 'all') {
    clauses.push('kind = ?');
    params.push(filters.kind);
  }
  if (filters.type && filters.type !== 'all') {
    clauses.push('type = ?');
    params.push(filters.type);
  }
  if (filters.status && filters.status !== 'all') {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.source_type && filters.source_type !== 'all') {
    clauses.push('source_type = ?');
    params.push(filters.source_type);
  }
  if (filters.tag) {
    clauses.push("tags_json LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeLike(filters.tag)}"%`);
  }
  if (filters.q?.trim()) {
    const pattern = `%${escapeLike(filters.q.trim())}%`;
    clauses.push("(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern, pattern);
  }
  const where = clauses.join(' AND ');
  const total = queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM library_entries WHERE ${where}`, params)?.count || 0;
  const limit = Math.min(Math.max(Math.floor(filters.limit || 40), 1), 100);
  const offset = Math.max(Math.floor(filters.offset || 0), 0);
  const order = filters.sort === 'updated_asc'
    ? 'updated_at ASC, created_at ASC, id ASC'
    : filters.sort === 'created_asc'
      ? 'created_at ASC, id ASC'
      : filters.sort === 'created_desc'
        ? 'created_at DESC, id DESC'
        : 'updated_at DESC, created_at DESC, id DESC';
  const isTitleSort = filters.sort === 'title_asc' || filters.sort === 'title_desc';
  const items = filters.fetchAll || isTitleSort
    ? queryAll<DbLibraryEntry>(`SELECT * FROM library_entries WHERE ${where}`, params)
    : queryAll<DbLibraryEntry>(
        `SELECT * FROM library_entries WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );
  return { items, total: Number(total) };
}

export function createLibraryEntry(entry: DbLibraryEntry): DbLibraryEntry {
  run(
    `INSERT INTO library_entries
     (id, user_id, kind, type, source_id, slug, title, content, summary, tags_json, status,
      source_type, source_ref, source_url, metadata_json, relations_json, content_hash, created_at, updated_at, published_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.user_id,
      entry.kind,
      entry.type,
      entry.source_id,
      entry.slug,
      entry.title,
      entry.content,
      entry.summary,
      entry.tags_json,
      entry.status,
      entry.source_type,
      entry.source_ref,
      entry.source_url,
      entry.metadata_json,
      entry.relations_json,
      entry.content_hash,
      entry.created_at,
      entry.updated_at,
      entry.published_at,
      entry.archived_at,
    ],
  );
  return entry;
}

export function updateLibraryEntry(
  id: string,
  userId: string,
  updates: Partial<Pick<DbLibraryEntry, 'kind' | 'type' | 'source_id' | 'slug' | 'title' | 'content' | 'summary' | 'tags_json' | 'status' | 'source_type' | 'source_ref' | 'source_url' | 'metadata_json' | 'relations_json' | 'content_hash' | 'updated_at' | 'published_at' | 'archived_at'>>,
): DbLibraryEntry | undefined {
  const fields: string[] = [];
  const values: any[] = [];
  const allowed = [
    'kind', 'type', 'source_id', 'slug', 'title', 'content', 'summary', 'tags_json', 'status',
    'source_type', 'source_ref', 'source_url', 'metadata_json', 'content_hash', 'updated_at',
    'published_at', 'archived_at', 'relations_json',
  ] as const;
  for (const field of allowed) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(updates[field]);
    }
  }
  if (!fields.length) return getLibraryEntry(id, userId);
  values.push(id, userId);
  run(`UPDATE library_entries SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  return getLibraryEntry(id, userId);
}

export function deleteLibraryEntry(id: string, userId: string): boolean {
  if (!getLibraryEntry(id, userId)) return false;
  run('DELETE FROM library_comments WHERE entry_id = ? AND user_id = ?', [id, userId]);
  run('DELETE FROM library_entry_versions WHERE entry_id = ? AND user_id = ?', [id, userId]);
  return run('DELETE FROM library_entries WHERE id = ? AND user_id = ?', [id, userId]).changes > 0;
}

export function parseLibraryRelations(value: string): Array<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
      : [];
  } catch {
    return [];
  }
}

export function relationTouchesSourceIds(relation: Record<string, unknown>, sourceIds: Set<string>): boolean {
  const sourceId = String(relation.sourceId || '').trim();
  const targetSourceId = String(relation.targetSourceId || '').trim();
  return sourceIds.has(sourceId) || sourceIds.has(targetSourceId);
}

export function createRelationChangeVersion(row: DbLibraryEntry, relationsJson: string, createdAt: string): void {
  if (row.kind !== 'article') return;
  executeWithoutSave(
    `INSERT INTO library_entry_versions
     (id, entry_id, user_id, content_hash, title, summary, content, tags_json, relations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), row.id, row.user_id, row.content_hash, row.title, row.summary, row.content, row.tags_json, relationsJson, createdAt],
  );
}

export function applyLibraryLifecycle(userId: string, sourceIds: string[], action: LibraryLifecycleAction): LibraryLifecycleResult {
  const normalizedSourceIds = [...new Set(sourceIds.map(sourceId => String(sourceId || '').trim()).filter(Boolean))];
  if (!normalizedSourceIds.length) {
    return { action, items: [], cleanedRelationCount: 0, touchedEntryCount: 0 };
  }

  const placeholders = normalizedSourceIds.map(() => '?').join(', ');
  return runTransaction(() => {
    const rows = queryAll<DbLibraryEntry>(
      `SELECT * FROM library_entries WHERE user_id = ? AND source_id IN (${placeholders})`,
      [userId, ...normalizedSourceIds],
    );
    const rowBySourceId = new Map(rows.map(row => [row.source_id || '', row]));
    const targetSet = new Set(normalizedSourceIds);
    const now = new Date().toISOString();
    let cleanedRelationCount = 0;
    const touchedEntryIds = new Set<string>();

    if (action !== 'restore') {
      const allRows = queryAll<DbLibraryEntry>('SELECT * FROM library_entries WHERE user_id = ?', [userId]);
      for (const row of allRows) {
        const relations = parseLibraryRelations(row.relations_json);
        const remainingRelations = relations.filter(relation => !relationTouchesSourceIds(relation, targetSet));
        const removedCount = relations.length - remainingRelations.length;
        const isTarget = Boolean(row.source_id && targetSet.has(row.source_id));
        if (removedCount > 0) cleanedRelationCount += removedCount;

        if (action === 'retire' && isTarget) {
          const relationsJson = JSON.stringify(remainingRelations);
          const statusChanged = row.status !== 'archived' || row.archived_at === null;
          const relationChanged = relationsJson !== row.relations_json;
          if (statusChanged || relationChanged) {
            executeWithoutSave(
              `UPDATE library_entries
               SET status = 'archived', archived_at = COALESCE(archived_at, ?), relations_json = ?, updated_at = ?
               WHERE id = ? AND user_id = ?`,
              [now, relationsJson, now, row.id, userId],
            );
            if (relationChanged) createRelationChangeVersion(row, relationsJson, now);
            touchedEntryIds.add(row.id);
          }
        } else if (action === 'purge' && isTarget) {
          executeWithoutSave('DELETE FROM library_comments WHERE entry_id = ? AND user_id = ?', [row.id, userId]);
          executeWithoutSave('DELETE FROM library_entry_versions WHERE entry_id = ? AND user_id = ?', [row.id, userId]);
          executeWithoutSave('DELETE FROM library_entries WHERE id = ? AND user_id = ?', [row.id, userId]);
          touchedEntryIds.add(row.id);
        } else if (removedCount > 0) {
          const relationsJson = JSON.stringify(remainingRelations);
          executeWithoutSave(
            'UPDATE library_entries SET relations_json = ?, updated_at = ? WHERE id = ? AND user_id = ?',
            [relationsJson, now, row.id, userId],
          );
          createRelationChangeVersion(row, relationsJson, now);
          touchedEntryIds.add(row.id);
        }
      }
    } else {
      for (const row of rows) {
        if (row.status !== 'archived') continue;
        executeWithoutSave(
          "UPDATE library_entries SET status = 'active', archived_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?",
          [now, row.id, userId],
        );
        touchedEntryIds.add(row.id);
      }
    }

    const items = normalizedSourceIds.map(sourceId => {
      const row = rowBySourceId.get(sourceId);
      if (action === 'purge') return row
        ? { sourceId, status: 'PURGED' as const, entryId: row.id }
        : { sourceId, status: 'NOT_FOUND' as const };
      if (!row) return { sourceId, status: 'NOT_FOUND' as const };
      if (action === 'retire') return row.status === 'archived'
        ? { sourceId, status: 'UNCHANGED' as const, entryId: row.id }
        : { sourceId, status: 'RETIRED' as const, entryId: row.id };
      return row.status === 'archived'
        ? { sourceId, status: 'RESTORED' as const, entryId: row.id }
        : { sourceId, status: 'UNCHANGED' as const, entryId: row.id };
    });
    return { action, items, cleanedRelationCount, touchedEntryCount: touchedEntryIds.size };
  });
}

export function createLibraryEntryVersion(version: DbLibraryEntryVersion): DbLibraryEntryVersion {
  run(
    `INSERT INTO library_entry_versions
     (id, entry_id, user_id, content_hash, title, summary, content, tags_json, relations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [version.id, version.entry_id, version.user_id, version.content_hash, version.title, version.summary, version.content, version.tags_json, version.relations_json, version.created_at],
  );
  return version;
}

export function listLibraryEntryVersions(entryId: string, userId: string): DbLibraryEntryVersion[] {
  return queryAll<DbLibraryEntryVersion>(
    `SELECT v.* FROM library_entry_versions v
     JOIN library_entries e ON e.id = v.entry_id
     WHERE v.entry_id = ? AND v.user_id = ? AND e.user_id = ?
     ORDER BY v.created_at DESC, v.id DESC`,
    [entryId, userId, userId],
  );
}

export function listLibraryComments(entryId: string, userId: string): DbLibraryComment[] {
  return queryAll<DbLibraryComment>(
    `SELECT c.* FROM library_comments c
     JOIN library_entries e ON e.id = c.entry_id
     WHERE c.entry_id = ? AND c.user_id = ? AND e.user_id = ?
     ORDER BY c.created_at ASC, c.id ASC`,
    [entryId, userId, userId],
  );
}

export function createLibraryComment(comment: DbLibraryComment): DbLibraryComment {
  run(
    `INSERT INTO library_comments (id, entry_id, user_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [comment.id, comment.entry_id, comment.user_id, comment.content, comment.created_at, comment.updated_at],
  );
  return comment;
}

export function deleteLibraryComment(id: string, entryId: string, userId: string): boolean {
  return run(
    'DELETE FROM library_comments WHERE id = ? AND entry_id = ? AND user_id = ?',
    [id, entryId, userId],
  ).changes > 0;
}

export function getLibraryPublishToken(userId: string): DbLibraryPublishToken | undefined {
  return queryOne<DbLibraryPublishToken>('SELECT * FROM library_publish_tokens WHERE user_id = ?', [userId]);
}

export function replaceLibraryPublishToken(token: DbLibraryPublishToken): DbLibraryPublishToken {
  run('DELETE FROM library_publish_tokens WHERE user_id = ?', [token.user_id]);
  run(
    `INSERT INTO library_publish_tokens
     (id, user_id, token_hash, token_prefix, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [token.id, token.user_id, token.token_hash, token.token_prefix, token.created_at, token.last_used_at, token.revoked_at],
  );
  return token;
}

export function revokeLibraryPublishToken(userId: string, revokedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE library_publish_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    [revokedAt, userId],
  ).changes > 0;
}

export function findActiveLibraryPublishTokenByHash(tokenHash: string): DbLibraryPublishToken | undefined {
  return queryOne<DbLibraryPublishToken>(
    `SELECT t.* FROM library_publish_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
    [tokenHash],
  );
}

export function markLibraryPublishTokenUsed(id: string, usedAt = new Date().toISOString()): void {
  run('UPDATE library_publish_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL', [usedAt, id]);
}

export function exportUserLibraryEntries(userId: string): DbLibraryEntry[] {
  return queryAll<DbLibraryEntry>('SELECT * FROM library_entries WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [userId]);
}

export function restoreUserLibraryEntries(
  userId: string,
  rows: Array<Partial<DbLibraryEntry> & { sourceId?: unknown; sourceType?: unknown; sourceRef?: unknown; sourceUrl?: unknown; tags?: unknown; metadata?: unknown; relations?: unknown }>,
  mode: 'merge' | 'replace',
): { entries: number; versions: number } {
  if (mode === 'replace') {
    run('DELETE FROM library_comments WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entry_versions WHERE user_id = ?', [userId]);
    run('DELETE FROM library_entries WHERE user_id = ?', [userId]);
  }
  let entries = 0;
  let versions = 0;
  for (const row of rows || []) {
    const id = String(row.id || '').trim() || crypto.randomUUID();
    if (getLibraryEntry(id, userId)) continue;
    const sourceId = String(row.source_id ?? row.sourceId ?? '').trim() || null;
    if (sourceId && getLibraryEntryBySourceId(sourceId, userId)) continue;
    const now = new Date().toISOString();
    const kind = row.kind === 'article' ? 'article' : 'fragment';
    const typeValues = ['knowledge', 'insight', 'framework', 'experience', 'tutorial', 'reference'] as const;
    const type = (typeValues as readonly string[]).includes(String(row.type)) ? String(row.type) as DbLibraryEntry['type'] : 'knowledge';
    const statusValues = ['draft', 'active', 'archived'] as const;
    const status = (statusValues as readonly string[]).includes(String(row.status)) ? String(row.status) as DbLibraryEntry['status'] : 'active';
    const content = String(row.content || '').trim();
    if (!content) continue;
    const tags = Array.isArray(row.tags)
      ? row.tags
      : typeof row.tags_json === 'string'
        ? (() => { try { return JSON.parse(row.tags_json); } catch { return []; } })()
        : [];
    const entry: DbLibraryEntry = {
      id,
      user_id: userId,
      kind,
      type,
      source_id: sourceId,
      slug: String(row.slug || '').trim() || null,
      title: String(row.title || '').trim() || null,
      content,
      summary: String(row.summary || '').trim(),
      tags_json: JSON.stringify(Array.isArray(tags) ? tags.map(tag => String(tag || '').trim()).filter(Boolean).slice(0, 50) : []),
      status,
      source_type: String(row.source_type ?? row.sourceType ?? 'manual').trim() || 'manual',
      source_ref: String(row.source_ref ?? row.sourceRef ?? '').trim() || null,
      source_url: String(row.source_url ?? row.sourceUrl ?? '').trim() || null,
      metadata_json: typeof row.metadata_json === 'string'
        ? row.metadata_json
        : JSON.stringify(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
      relations_json: typeof row.relations_json === 'string'
        ? row.relations_json
        : JSON.stringify(Array.isArray(row.relations) ? row.relations : []),
      content_hash: String(row.content_hash || crypto.createHash('sha256').update(content, 'utf8').digest('hex')),
      created_at: String(row.created_at || now),
      updated_at: String(row.updated_at || now),
      published_at: String(row.published_at || '').trim() || null,
      archived_at: String(row.archived_at || '').trim() || null,
    };
    createLibraryEntry(entry);
    entries++;
    if (kind === 'article') {
      createLibraryEntryVersion({
        id: crypto.randomUUID(),
        entry_id: id,
        user_id: userId,
        content_hash: entry.content_hash,
        title: entry.title,
        summary: entry.summary,
        content: entry.content,
        tags_json: entry.tags_json,
        relations_json: entry.relations_json,
        created_at: entry.updated_at,
      });
      versions++;
    }
  }
  return { entries, versions };
}
