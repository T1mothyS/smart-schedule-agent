import { queryAll, queryOne, run } from '../connection.js';
import type { DbSession, DbMessage, DbAiScheduleMessage } from '../types.js';

export function getAllSessions(userId: string): DbSession[] {
  return queryAll<DbSession>('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
}

export function getSession(id: string, userId: string): DbSession | undefined {
  return queryOne<DbSession>('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [id, userId]);
}

export function createSession(session: DbSession): DbSession {
  run(
    'INSERT INTO sessions (id, user_id, title, model, sdk_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [session.id, session.user_id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at]
  );
  return session;
}

export function updateSession(id: string, userId: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  values.push(userId);

  const result = run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
  return result.changes > 0;
}

export function deleteSession(id: string, userId: string): boolean {
  if (!getSession(id, userId)) return false;
  run('DELETE FROM messages WHERE session_id = ?', [id]);
  const result = run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, userId]);
  return result.changes > 0;
}

export function getMessagesBySession(sessionId: string, userId: string): DbMessage[] {
  return queryAll<DbMessage>(
    'SELECT messages.* FROM messages JOIN sessions ON sessions.id = messages.session_id WHERE messages.session_id = ? AND sessions.user_id = ? ORDER BY messages.created_at ASC',
    [sessionId, userId]
  );
}

export function createMessage(message: DbMessage, userId: string): DbMessage {
  if (!getSession(message.session_id, userId)) throw new Error('会话不存在或无权访问');
  run(
    'INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [message.id, message.session_id, message.role, message.content, message.model, message.created_at, message.tool_calls]
  );

  run('UPDATE sessions SET updated_at = ? WHERE id = ? AND user_id = ?', [new Date().toISOString(), message.session_id, userId]);

  return message;
}

export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }

  if (fields.length === 0) return false;

  values.push(id);

  const result = run(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`, values);
  return result.changes > 0;
}

export function deleteMessage(id: string): boolean {
  const result = run('DELETE FROM messages WHERE id = ?', [id]);
  return result.changes > 0;
}

export function createMessages(messages: DbMessage[], userId: string): void {
  for (const msg of messages) {
    createMessage(msg, userId);
  }
}

export function getAiScheduleMessages(userId: string, limit = 20): DbAiScheduleMessage[] {
  if (limit <= 0) {
    return queryAll<DbAiScheduleMessage>(
      'SELECT * FROM ai_schedule_messages WHERE user_id = ? ORDER BY created_at ASC',
      [userId],
    );
  }
  const safeLimit = Math.min(Math.floor(limit) || 20, 2000);
  return queryAll<DbAiScheduleMessage>(
    'SELECT * FROM ai_schedule_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, safeLimit],
  ).reverse();
}

export function createAiScheduleMessage(message: DbAiScheduleMessage): DbAiScheduleMessage {
  run(
    `INSERT INTO ai_schedule_messages
      (id, user_id, role, type, content, intent, schedule_items, plan, knowledge_sources, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.user_id,
      message.role,
      message.type,
      message.content,
      message.intent,
      message.schedule_items,
      message.plan,
      message.knowledge_sources ?? null,
      message.created_at,
    ],
  );
  return message;
}

export function updateAiScheduleMessage(
  id: string,
  userId: string,
  updates: Partial<Pick<DbAiScheduleMessage, 'type' | 'content' | 'intent' | 'schedule_items' | 'plan' | 'knowledge_sources'>>,
): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  for (const field of ['type', 'content', 'intent', 'schedule_items', 'plan', 'knowledge_sources'] as const) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = ?`);
      values.push(updates[field]);
    }
  }
  if (!fields.length) return false;
  values.push(id, userId);
  return run(`UPDATE ai_schedule_messages SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values).changes > 0;
}

export function deleteAiScheduleMessage(id: string, userId: string): boolean {
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM ai_schedule_messages WHERE id = ? AND user_id = ?',
    [id, userId],
  );
  if (!existing) return false;
  run('DELETE FROM ai_schedule_messages WHERE id = ? AND user_id = ?', [id, userId]);
  return true;
}

export function deleteExpiredAiScheduleMessages(beforeIso: string, userId?: string): number {
  const rows = userId
    ? queryAll<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM ai_schedule_messages WHERE user_id = ? AND created_at < ? ORDER BY created_at ASC',
        [userId, beforeIso],
      )
    : queryAll<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM ai_schedule_messages WHERE created_at < ? ORDER BY created_at ASC',
        [beforeIso],
      );
  let deleted = 0;
  for (const row of rows) {
    if (deleteAiScheduleMessage(row.id, row.user_id)) deleted += 1;
  }
  return deleted;
}

export function clearAllData(): void {
  run('DELETE FROM messages');
  run('DELETE FROM sessions');
  run('DELETE FROM ai_schedule_messages');
  run('DELETE FROM note_items');
}
