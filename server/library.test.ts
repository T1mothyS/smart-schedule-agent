import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-library-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.JWT_SECRET = 'library-test-jwt-secret';

const api = await import('./index.js');
const db = await import('./db.js');
const libraryTokens = await import('./library-publish-token-service.js');
const libraryMarkdown = await import('./library-markdown.js');

await api.initializeServer();

const now = new Date().toISOString();
const user = db.createUser({ id: 'library-user-a', email: 'library-a@example.com', password_hash: 'test', role: 'user', disabled: 0, created_at: now, updated_at: now });
const otherUser = db.createUser({ id: 'library-user-b', email: 'library-b@example.com', password_hash: 'test', role: 'user', disabled: 0, created_at: now, updated_at: now });
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

test('知识库 API 支持 fragment、搜索、编辑、归档、评论和账号隔离', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (pathname: string, token: string, init: RequestInit = {}) => fetch(baseUrl + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  try {
    const created = await request('/api/library', userToken, { method: 'POST', ...json({
      kind: 'fragment', type: 'insight', content: '一段值得长期保留的结构化观察。', tags: ['工作', '认知'],
    }) });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(createdPayload.success, true);
    assert.equal(createdPayload.entry.kind, 'fragment');
    assert.equal(createdPayload.entry.summary, '一段值得长期保留的结构化观察。');
    const fragmentId = createdPayload.entry.id as string;

    const searched = await request('/api/library?q=结构化&kind=fragment', userToken);
    assert.equal(searched.status, 200);
    assert.equal((await searched.json()).total, 1);

    const otherList = await request('/api/library', otherToken);
    assert.equal((await otherList.json()).total, 0);
    const otherDetail = await request(`/api/library/${fragmentId}`, otherToken);
    assert.equal(otherDetail.status, 404);
    const crossUpdate = await request(`/api/library/${fragmentId}`, otherToken, { method: 'PATCH', ...json({ content: '越权修改' }) });
    assert.equal(crossUpdate.status, 404);

    const updated = await request(`/api/library/${fragmentId}`, userToken, { method: 'PATCH', ...json({ content: '<script>alert(1)</script>\n\n**更新后的正文**' }) });
    assert.equal(updated.status, 200);
    const updatedPayload = await updated.json();
    assert.equal(updatedPayload.status, 'UPDATED');
    assert.match(updatedPayload.entry.html, /&lt;script&gt;/);
    assert.doesNotMatch(updatedPayload.entry.html, /<script>/);

    const comment = await request(`/api/library/${fragmentId}/comments`, userToken, { method: 'POST', ...json({ content: '后续补充一个反例。' }) });
    assert.equal(comment.status, 201);
    const detail = await request(`/api/library/${fragmentId}`, userToken);
    const detailPayload = await detail.json();
    assert.equal(detailPayload.comments.length, 1);

    const archived = await request(`/api/library/${fragmentId}/archive`, userToken, { method: 'POST' });
    assert.equal(archived.status, 200);
    const activeList = await request('/api/library', userToken);
    assert.equal((await activeList.json()).total, 0);
    const allList = await request('/api/library?status=all', userToken);
    assert.equal((await allList.json()).total, 1);

    const deleted = await request(`/api/library/${fragmentId}`, userToken, { method: 'DELETE', ...json({ confirm: true }) });
    assert.equal(deleted.status, 200);
    const deletedDetail = await request(`/api/library/${fragmentId}`, userToken);
    assert.equal(deletedDetail.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('正式知识发布令牌只保存哈希，发布按 sourceId 幂等并保留版本', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (pathname: string, token: string, init: RequestInit = {}) => fetch(baseUrl + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  try {
    const generated = await request('/api/library/publish-token', userToken, { method: 'POST' });
    assert.equal(generated.status, 200);
    const generatedPayload = await generated.json();
    const publishToken = generatedPayload.token as string;
    assert.match(publishToken, /^klp_/);
    const stored = db.getLibraryPublishToken(user.id)!;
    assert.notEqual(stored.token_hash, publishToken);
    assert.equal(stored.token_hash, libraryTokens.hashLibraryPublishToken(publishToken));

    const publishBody = { sourceId: 'migration:knowledge:stable-entry', type: 'framework', title: '稳定发布条目', content: '# 稳定发布条目\n\n第一版正文', tags: ['迁移'], sourceType: 'migration', sourceRef: '框架/stable.md' };
    const created = await request('/api/library/publish', publishToken, { method: 'POST', ...json(publishBody) });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(createdPayload.status, 'CREATED');
    const entryId = createdPayload.entry.id as string;

    const exported = await request(`/api/library/${entryId}/export`, userToken);
    assert.equal(exported.status, 200);
    assert.match(await exported.text(), /sourceId: "migration:knowledge:stable-entry"/);

    const duplicate = await request('/api/library/publish', publishToken, { method: 'POST', ...json(publishBody) });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).status, 'UNCHANGED');
    assert.equal(db.listLibraryEntryVersions(entryId, user.id).length, 1);

    const changed = await request('/api/library/publish', publishToken, { method: 'POST', ...json({ ...publishBody, content: `${publishBody.content}\n\n第二版修订` }) });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).status, 'UPDATED');
    assert.equal(db.listLibraryEntryVersions(entryId, user.id).length, 2);

    const revoked = await request('/api/library/publish-token', userToken, { method: 'DELETE' });
    assert.equal(revoked.status, 200);
    const rejected = await request('/api/library/publish', publishToken, { method: 'POST', ...json(publishBody) });
    assert.equal(rejected.status, 401);

    const otherGenerated = await request('/api/integrations/library-token', otherToken, { method: 'POST' });
    assert.equal(otherGenerated.status, 200);
    const otherGeneratedPayload = await otherGenerated.json();
    const otherPublished = await request('/api/integrations/library', otherGeneratedPayload.token, { method: 'POST', ...json({
      ...publishBody,
      sourceId: 'migration:other:entry',
    }) });
    assert.equal(otherPublished.status, 201);
    const userListAfterOtherPublish = await request('/api/library?status=all', userToken);
    assert.equal((await userListAfterOtherPublish.json()).total, 1);
    const otherListAfterPublish = await request('/api/library?status=all', otherToken);
    assert.equal((await otherListAfterPublish.json()).total, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('知识碎片可以生成独立的正式知识草稿，Markdown 渲染不信任原始 HTML 和危险链接', () => {
  const rendered = libraryMarkdown.renderLibraryMarkdown([
    '# 标题',
    '',
    '- 一项',
    '- **加粗**',
    '',
    '[危险](javascript:alert(1))',
    '',
    '<script>alert(1)</script>',
  ].join('\n'));
  assert.match(rendered, /<h1>标题<\/h1>/);
  assert.match(rendered, /<ul>/);
  assert.match(rendered, /&lt;script&gt;/);
  assert.doesNotMatch(rendered, /javascript:/);
});
