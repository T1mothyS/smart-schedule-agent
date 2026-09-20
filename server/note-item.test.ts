import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RequestHandler } from 'express';
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
const { createApp } = await import('./app.js');
const { createNotesRouter } = await import('./routes/notes.js');

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

test('记事合并按目标在前追加来源，并以事务移入废纸篓', async () => {
  const mergeUser = db.createUser({
    id: 'note-merge-user',
    email: 'note-merge-user@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
  const mergeOtherUser = db.createUser({
    id: 'note-merge-other-user',
    email: 'note-merge-other-user@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
  const mergeToken = api.signUserToken(mergeUser);
  const mergeOtherToken = api.signUserToken(mergeOtherUser);
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (pathname: string, token: string, init: RequestInit = {}) => fetch(baseUrl + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  try {
    const [source] = noteItems.createNoteItems(mergeUser.id, ['来源第一行\n来源第二行'], 'rose');
    const [target] = noteItems.createNoteItems(mergeUser.id, ['目标正文'], 'blue');
    noteItems.commitOptimizedNote(mergeUser.id, target.id, '目标正文', 0, '目标优化');
    const mergedResponse = await request(`/api/note-items/${source.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: target.id }),
    });
    assert.equal(mergedResponse.status, 200);
    const merged = await mergedResponse.json();
    assert.equal(merged.target.id, target.id);
    assert.equal(merged.target.content, '目标优化\n来源第一行\n来源第二行');
    assert.equal(merged.target.completed, false);
    assert.equal(merged.target.color, 'blue');
    assert.equal(merged.target.isOptimized, false);
    assert.equal(merged.target.optimizationCount, 1);
    assert.equal(merged.target.contentRevision, 2);
    assert.equal(merged.source.id, source.id);
    assert.equal(merged.source.completed, true);
    assert.equal(merged.source.content, source.content);
    assert.equal(merged.source.color, 'rose');

    const [trashSource] = noteItems.createNoteItems(mergeUser.id, ['废纸篓来源'], 'green');
    await request(`/api/note-items/${trashSource.id}`, mergeToken, {
      method: 'PATCH',
      body: JSON.stringify({ completed: true }),
    });
    const [activeTarget] = noteItems.createNoteItems(mergeUser.id, ['进行中目标'], 'neutral');
    const trashToActive = await request(`/api/note-items/${trashSource.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: activeTarget.id }),
    });
    assert.equal(trashToActive.status, 200);
    const trashToActiveResult = await trashToActive.json();
    assert.equal(trashToActiveResult.target.content, '进行中目标\n废纸篓来源');
    assert.equal(trashToActiveResult.target.completed, false);
    assert.equal(trashToActiveResult.source.completed, true);

    const [activeSource] = noteItems.createNoteItems(mergeUser.id, ['进行中来源'], 'purple');
    const [trashTarget] = noteItems.createNoteItems(mergeUser.id, ['废纸篓目标'], 'amber');
    await request(`/api/note-items/${trashTarget.id}`, mergeToken, {
      method: 'PATCH',
      body: JSON.stringify({ completed: true }),
    });
    const activeToTrash = await request(`/api/note-items/${activeSource.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: trashTarget.id }),
    });
    assert.equal(activeToTrash.status, 200);
    const activeToTrashResult = await activeToTrash.json();
    assert.equal(activeToTrashResult.target.content, '废纸篓目标\n进行中来源');
    assert.equal(activeToTrashResult.target.completed, true);
    assert.equal(activeToTrashResult.target.color, 'amber');
    assert.equal(activeToTrashResult.source.completed, true);

    const [sameNote] = noteItems.createNoteItems(mergeUser.id, ['不能合并自己']);
    const sameResponse = await request(`/api/note-items/${sameNote.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: sameNote.id }),
    });
    assert.equal(sameResponse.status, 400);
    assert.match(String((await sameResponse.json()).error), /不能相同/);
    assert.equal(noteItems.getNoteItem(mergeUser.id, sameNote.id)?.content, '不能合并自己');

    const missingTargetResponse = await request(`/api/note-items/${sameNote.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: 'missing-target' }),
    });
    assert.equal(missingTargetResponse.status, 404);
    const missingSourceResponse = await request('/api/note-items/missing-source/merge', mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: sameNote.id }),
    });
    assert.equal(missingSourceResponse.status, 404);

    const [longSource] = noteItems.createNoteItems(mergeUser.id, ['s'.repeat(1_001)]);
    const [longTarget] = noteItems.createNoteItems(mergeUser.id, ['t'.repeat(999)]);
    const tooLongResponse = await request(`/api/note-items/${longSource.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: longTarget.id }),
    });
    assert.equal(tooLongResponse.status, 400);
    assert.match(String((await tooLongResponse.json()).error), /2,000/);
    const unchangedLongSource = noteItems.getNoteItem(mergeUser.id, longSource.id);
    const unchangedLongTarget = noteItems.getNoteItem(mergeUser.id, longTarget.id);
    assert.equal(unchangedLongSource?.content, 's'.repeat(1_001));
    assert.equal(unchangedLongSource?.completed, false);
    assert.equal(unchangedLongTarget?.content, 't'.repeat(999));
    assert.equal(unchangedLongTarget?.completed, false);

    const [foreignTarget] = noteItems.createNoteItems(mergeOtherUser.id, ['其他账号目标']);
    const crossAccountResponse = await request(`/api/note-items/${sameNote.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: foreignTarget.id }),
    });
    assert.equal(crossAccountResponse.status, 404);
    const [foreignSource] = noteItems.createNoteItems(mergeOtherUser.id, ['其他账号来源']);
    const foreignSourceResponse = await request(`/api/note-items/${foreignSource.id}/merge`, mergeToken, {
      method: 'POST',
      body: JSON.stringify({ targetId: sameNote.id }),
    });
    assert.equal(foreignSourceResponse.status, 404);
    assert.equal((await request('/api/note-items', mergeOtherToken)).status, 200);
  } finally {
    db.clearUserData(mergeUser.id);
    db.clearUserData(mergeOtherUser.id);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('提示词优化状态支持条件提交、单步撤回、累计次数和手动新基线', async () => {
  const [note] = noteItems.createNoteItems(user.id, ['original'], 'purple');
  noteItems.updateNoteItem(user.id, note.id, { completed: true });
  const completed = noteItems.getNoteItem(user.id, note.id)!;
  assert.equal(completed.isOptimized, false);
  assert.equal(completed.optimizationCount, 0);
  assert.equal(completed.contentRevision, 0);
  assert.throws(
    () => noteItems.commitOptimizedNote(user.id, note.id, 'stale', 0, 'should not save'),
    noteItems.NoteContentConflict,
  );
  const optimized = noteItems.commitOptimizedNote(user.id, note.id, 'original', 0, 'optimized')!;
  assert.equal(optimized.content, 'optimized');
  assert.equal(optimized.isOptimized, true);
  assert.equal(optimized.optimizationCount, 1);
  assert.equal(optimized.contentRevision, 1);
  assert.equal(optimized.completed, true);
  const recolored = noteItems.updateNoteItem(user.id, note.id, { color: 'blue' })!;
  assert.equal(recolored.isOptimized, true);
  assert.equal(recolored.optimizationCount, 1);
  const reverted = noteItems.revertOptimizedNote(user.id, note.id, 'optimized', 1)!;
  assert.equal(reverted.content, 'original');
  assert.equal(reverted.isOptimized, false);
  assert.equal(reverted.optimizationCount, 1);
  assert.equal(reverted.contentRevision, 2);
  assert.throws(
    () => noteItems.revertOptimizedNote(user.id, note.id, 'original', 2),
    error => error instanceof noteItems.NoteOptimizationConflict && error.code === 'NOT_OPTIMIZED',
  );
  const optimizedAgain = noteItems.commitOptimizedNote(user.id, note.id, 'original', 2, 'optimized again')!;
  const manual = noteItems.updateNoteItem(user.id, note.id, {
    content: 'manual baseline', expectedContent: optimizedAgain.content, expectedRevision: optimizedAgain.contentRevision,
  })!;
  assert.equal(manual.content, 'manual baseline');
  assert.equal(manual.isOptimized, false);
  assert.equal(manual.optimizationCount, 2);
  assert.equal(manual.contentRevision, 4);

  const server = http.createServer(api.app); const port = await listen(server);
  const request = (token: string, body: object) => fetch(`http://127.0.0.1:${port}/api/note-items/${note.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await request(otherToken, { content: 'x', expectedContent: 'manual baseline', expectedRevision: 4 })).status, 404);
    assert.equal((await request(userToken, { content: 'x', expectedContent: 'outdated', expectedRevision: 4 })).status, 409);
    const unauthorizedOptimize = await fetch(`http://127.0.0.1:${port}/api/note-items/${note.id}/optimize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedContent: 'manual baseline', expectedRevision: 4 }),
    });
    assert.equal(unauthorizedOptimize.status, 401);
    const crossAccountOptimize = await fetch(`http://127.0.0.1:${port}/api/note-items/${note.id}/optimize`, {
      method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedContent: 'manual baseline', expectedRevision: 4 }),
    });
    assert.equal(crossAccountOptimize.status, 404);
    const endpoint = `http://127.0.0.1:${port}/api/ai/prompt-optimize`;
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    for (const text of ['', 'x'.repeat(2001), {}]) {
      assert.equal((await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).status, 400);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('提示词优化路由成功提交、失败不变并支持账号隔离与重复撤回冲突', async () => {
  const routeUser = db.createUser({
    id: 'note-route-user', email: 'note-route-user@example.com', password_hash: 'not-a-real-password', role: 'user', disabled: 0, created_at: now, updated_at: now,
  });
  const [routeNote] = noteItems.createNoteItems(routeUser.id, ['route original']);
  const [failedNote] = noteItems.createNoteItems(routeUser.id, ['route fail']);
  const authenticate: RequestHandler = (req, _res, next) => {
    (req as any).user = { userId: routeUser.id };
    next();
  };
  const app = createApp({ isProduction: false, isReady: () => true });
  app.use(createNotesRouter({
    authenticate,
    optimizePrompt: async (_userId, text) => {
      if (String(text) === 'route fail') throw new Error('synthetic optimizer failure');
      return { runId: 'test-run-id', input: String(text), optimizedText: 'route optimized' };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const request = (pathname: string, body: object) => fetch(base + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const failedResponse = await request(`/api/note-items/${failedNote.id}/optimize`, { expectedContent: failedNote.content, expectedRevision: 0 });
    assert.equal(failedResponse.status, 502);
    assert.deepEqual(noteItems.getNoteItem(routeUser.id, failedNote.id), failedNote);

    const optimizedResponse = await request(`/api/note-items/${routeNote.id}/optimize`, { expectedContent: routeNote.content, expectedRevision: 0 });
    assert.equal(optimizedResponse.status, 200);
    const optimized = (await optimizedResponse.json()).item;
    assert.equal(optimized.content, 'route optimized');
    assert.equal(optimized.isOptimized, true);
    assert.equal(optimized.optimizationCount, 1);
    assert.equal(optimized.contentRevision, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(optimized, 'optimization_previous_content'), false);

    const duplicate = await request(`/api/note-items/${routeNote.id}/optimize`, { expectedContent: 'route optimized', expectedRevision: 1 });
    assert.equal(duplicate.status, 409);
    const revertedResponse = await request(`/api/note-items/${routeNote.id}/revert-optimization`, { expectedContent: 'route optimized', expectedRevision: 1 });
    assert.equal(revertedResponse.status, 200);
    const reverted = (await revertedResponse.json()).item;
    assert.equal(reverted.content, 'route original');
    assert.equal(reverted.isOptimized, false);
    assert.equal(reverted.optimizationCount, 1);
    assert.equal(reverted.contentRevision, 2);
    const duplicateRevert = await request(`/api/note-items/${routeNote.id}/revert-optimization`, { expectedContent: 'route original', expectedRevision: 2 });
    assert.equal(duplicateRevert.status, 409);

    const stale = await request(`/api/note-items/${routeNote.id}/optimize`, { expectedContent: 'route original', expectedRevision: 0 });
    assert.equal(stale.status, 409);
    assert.equal(noteItems.getNoteItem(routeUser.id, routeNote.id)?.content, 'route original');
  } finally {
    db.clearUserData(routeUser.id);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
