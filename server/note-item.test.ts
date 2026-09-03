import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { NoteItem } from './note-item-service.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-note-items-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';

const api = await import('./index.js');
const db = await import('./db.js');
const noteItems = await import('./note-item-service.js');
const backups = await import('./backup-service.js');
const readableExport = await import('./export-service.js');

await api.initializeServer();

const now = new Date().toISOString();
const user = db.createUser({
  id: 'note-user-1',
  email: 'note-user-1@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
const otherUser = db.createUser({
  id: 'note-user-2',
  email: 'note-user-2@example.com',
  password_hash: 'not-a-real-password',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
const userToken = api.signUserToken(user);
const otherToken = api.signUserToken(otherUser);

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('测试服务器没有端口'));
      resolve(address.port);
    });
  });
}

test('记事 API 支持逐行保存、完成恢复、删除并隔离账号', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (pathname: string, token: string, init: RequestInit = {}) => fetch(baseUrl + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  try {
    const empty = await request('/api/note-items', userToken);
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).items, []);

    const created = await request('/api/note-items', userToken, {
      method: 'POST',
      body: JSON.stringify({ content: '  第一条\n\n第二条\n第一条  ' }),
    });
    assert.equal(created.status, 201);
    const createdItems = (await created.json()).items;
    assert.deepEqual(createdItems.map((item: NoteItem) => item.content), ['第一条', '第二条', '第一条']);
    assert.deepEqual(createdItems.map((item: NoteItem) => item.color), ['neutral', 'neutral', 'neutral']);

    const completed = await request(`/api/note-items/${createdItems[0].id}`, userToken, {
      method: 'PATCH',
      body: JSON.stringify({ completed: true, color: 'purple' }),
    });
    assert.equal(completed.status, 200);
    const completedItem = (await completed.json()).item;
    assert.equal(completedItem.completed, true);
    assert.equal(completedItem.color, 'purple');

    const recovered = await request(`/api/note-items/${createdItems[0].id}`, userToken, {
      method: 'PATCH',
      body: JSON.stringify({ content: '第一条（更新）', completed: false }),
    });
    assert.equal(recovered.status, 200);
    const recoveredItem = (await recovered.json()).item;
    assert.equal(recoveredItem.completed, false);
    assert.equal(recoveredItem.color, 'purple');

    const invalidColor = await request(`/api/note-items/${createdItems[0].id}`, userToken, {
      method: 'PATCH',
      body: JSON.stringify({ color: 'lime' }),
    });
    assert.equal(invalidColor.status, 400);
    assert.match(String((await invalidColor.json()).error), /颜色/);

    const invalidCreatedColor = await request('/api/note-items', userToken, {
      method: 'POST',
      body: JSON.stringify({ content: '非法颜色', color: 'lime' }),
    });
    assert.equal(invalidCreatedColor.status, 400);

    const weatherSource = await request(`/api/note-items/${createdItems[0].id}`, userToken, {
      method: 'PATCH',
      body: JSON.stringify({ content: '北京明天天气怎么样？' }),
    });
    assert.equal(weatherSource.status, 200);
    const sourceActionWithId = await request('/api/ai-chat', userToken, {
      method: 'POST',
      body: JSON.stringify({ text: '忽略来源内容', sourceNoteId: createdItems[0].id, targetDate: '2026-09-02' }),
    });
    assert.equal(sourceActionWithId.status, 400);
    assert.match(String((await sourceActionWithId.json()).error), /入口|移除|确认/);
    const sourceActionWithRequestedAction = await request('/api/ai-chat', userToken, {
      method: 'POST',
      body: JSON.stringify({ text: '普通对话内容', requestedAction: 'create_todo', targetDate: '2026-09-02' }),
    });
    assert.equal(sourceActionWithRequestedAction.status, 400);
    assert.match(String((await sourceActionWithRequestedAction.json()).error), /入口|移除|确认/);
    const restoredContent = await request(`/api/note-items/${createdItems[0].id}`, userToken, {
      method: 'PATCH',
      body: JSON.stringify({ content: '第一条（更新）' }),
    });
    assert.equal(restoredContent.status, 200);

    const otherList = await request('/api/note-items', otherToken);
    assert.deepEqual((await otherList.json()).items, []);
    const forbidden = await request(`/api/note-items/${createdItems[0].id}`, otherToken, { method: 'DELETE' });
    assert.equal(forbidden.status, 404);

    const tooLong = await request('/api/note-items', userToken, {
      method: 'POST',
      body: JSON.stringify({ content: 'x'.repeat(2_001) }),
    });
    assert.equal(tooLong.status, 400);

    const deleted = await request(`/api/note-items/${createdItems[1].id}`, userToken, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal(noteItems.listNoteItems(user.id).length, 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('记事进入加密备份和可读导出，旧备份缺少颜色或记事字段仍可恢复', () => {
  const sourceItems = noteItems.listNoteItems(user.id);
  assert.equal(sourceItems.length, 2);
  assert.equal(sourceItems[0].color, 'purple');
  const password = ['notes', 'backup', 'fixture'].join('-');
  const backup = backups.createUserBackup(user.id, password);
  const inspected = backups.inspectUserBackup(backup, password);
  assert.equal((inspected.counts as Record<string, number>).noteItems, 2);
  const readable = readableExport.createReadableUserExport(user.id);
  assert.equal(readable.noteItems.length, 2);
  assert.equal(readable.noteItems[0].color, 'purple');

  const restored = backups.restoreUserBackup(otherUser.id, backup, password, 'replace');
  assert.deepEqual(restored.noteItems, { items: 2 });
  const restoredItems = noteItems.listNoteItems(otherUser.id);
  assert.equal(restoredItems.length, 2);
  assert.equal(restoredItems[0].color, 'purple');
  assert.ok(restoredItems.every(item => !sourceItems.some(source => source.id === item.id)));

  const oldPayload = backups.decryptBackup<any>(backup, password);
  oldPayload.noteItems = oldPayload.noteItems.map((item: Record<string, unknown>) => {
    const { color: _color, ...withoutColor } = item;
    return withoutColor;
  });
  const oldColorBackup = backups.encryptBackup(oldPayload, password);
  const oldColorRestore = backups.restoreUserBackup(otherUser.id, oldColorBackup, password, 'replace');
  assert.deepEqual(oldColorRestore.noteItems, { items: 2 });
  assert.ok(noteItems.listNoteItems(otherUser.id).every(item => item.color === 'neutral'));

  delete oldPayload.noteItems;
  const oldBackup = backups.encryptBackup(oldPayload, password);
  const oldRestore = backups.restoreUserBackup(otherUser.id, oldBackup, password, 'replace');
  assert.deepEqual(oldRestore.noteItems, { items: 0 });
  assert.deepEqual(noteItems.listNoteItems(otherUser.id), []);

  db.clearUserData(user.id);
  assert.deepEqual(noteItems.listNoteItems(user.id), []);
});
