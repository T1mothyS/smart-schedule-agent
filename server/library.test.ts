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
const libraryService = await import('./library-service.js');
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

test('知识库网页只读、评论隔离并可导出原始 Markdown 与关系', async () => {
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
    const publishToken = (await generated.json()).token as string;
    const markdown = '---\nsourceId: kb:readonly\n---\n\n# 只读样本\n\n正文保留原样。\n';
    const publishBody = {
      sourceId: 'kb:readonly',
      type: 'insight',
      title: '只读样本',
      summary: '网页只读测试',
      content: markdown,
      tags: ['测试'],
      sourceType: 'codex',
      sourceRef: 'knowledge-v2/test/readonly.md',
      relations: [{ sourceId: 'kb:readonly', targetSourceId: 'kb:missing', type: 'related', label: '未上传目标', status: 'unresolved' }],
    };
    const created = await request('/api/integrations/library', publishToken, { method: 'POST', ...json(publishBody) });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    const entryId = createdPayload.entry.id as string;
    assert.deepEqual(createdPayload.entry.relations, publishBody.relations);

    for (const [method, pathname, body] of [
      ['POST', '/api/library', {}],
      ['PATCH', `/api/library/${entryId}`, { content: '网页不能修改' }],
      ['POST', `/api/library/${entryId}/archive`, {}],
      ['POST', `/api/library/${entryId}/promote`, {}],
      ['DELETE', `/api/library/${entryId}`, { confirm: true }],
    ] as const) {
      const response = await request(pathname, userToken, { method, ...json(body) });
      assert.equal(response.status, 405, `${method} ${pathname} 应返回只读错误`);
      assert.equal((await response.json()).error.code, 'READ_ONLY_LIBRARY');
    }

    const detail = await request(`/api/library/${entryId}`, userToken);
    assert.equal(detail.status, 200);
    const detailPayload = await detail.json();
    assert.equal(detailPayload.relations.items[0].status, 'unresolved');
    assert.equal(detailPayload.relations.items[0].targetSourceId, 'kb:missing');
    assert.equal(detailPayload.relations.items[0].targetEntryId, undefined);

    const comment = await request(`/api/library/${entryId}/comments`, userToken, { method: 'POST', ...json({ content: '补充一个验证点。' }) });
    assert.equal(comment.status, 201);
    const otherDetail = await request(`/api/library/${entryId}`, otherToken);
    assert.equal(otherDetail.status, 404);

    const exported = await request(`/api/library/${entryId}/export`, userToken);
    assert.equal(exported.status, 200);
    assert.equal(await exported.text(), markdown);

    const fullExport = await request('/api/library/export', userToken);
    assert.equal(fullExport.status, 200);
    const fullPayload = await fullExport.json();
    assert.equal(fullPayload.format, 'ai-calendar-library-export');
    assert.equal(fullPayload.manifest.entryCount, 1);
    assert.equal(fullPayload.entries[0].markdown, markdown);
    assert.equal(fullPayload.relations[0].targetSourceId, 'kb:missing');
    assert.equal(fullPayload.comments.length, 1);
    assert.doesNotMatch(JSON.stringify(fullPayload), /klp_[A-Za-z0-9]+/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('知识库排序偏好按账户保存，列表默认读取且显式排序不覆盖偏好', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (pathname: string, token: string, init: RequestInit = {}) => fetch(baseUrl + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  try {
    const initial = await request('/api/library/preferences', userToken);
    assert.equal(initial.status, 200);
    assert.deepEqual((await initial.json()).preference, { sort: 'created_desc', updatedAt: null });

    const otherInitial = await request('/api/library/preferences', otherToken);
    assert.equal(otherInitial.status, 200);
    assert.equal((await otherInitial.json()).preference.sort, 'created_desc');

    const saved = await request('/api/library/preferences', userToken, { method: 'PUT', ...json({ sort: 'title_asc' }) });
    assert.equal(saved.status, 200);
    const savedPayload = await saved.json();
    assert.equal(savedPayload.preference.sort, 'title_asc');
    assert.match(savedPayload.preference.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const defaultList = await request('/api/library?status=all&pageSize=100', userToken);
    assert.equal(defaultList.status, 200);
    assert.equal((await defaultList.json()).sort, 'title_asc');

    const explicitList = await request('/api/library?status=all&pageSize=100&sort=created_desc', userToken);
    assert.equal(explicitList.status, 200);
    assert.equal((await explicitList.json()).sort, 'created_desc');

    const unchangedPreference = await request('/api/library/preferences', userToken);
    assert.equal((await unchangedPreference.json()).preference.sort, 'title_asc');

    const otherList = await request('/api/library?status=all&pageSize=100', otherToken);
    assert.equal(otherList.status, 200);
    assert.equal((await otherList.json()).sort, 'created_desc');

    const invalid = await request('/api/library/preferences', userToken, { method: 'PUT', ...json({ sort: 'invalid_sort' }) });
    assert.equal(invalid.status, 400);
    const invalidPayload = await invalid.json();
    assert.equal(invalidPayload.error.code, 'INVALID_SORT');
    assert.equal(invalidPayload.error.field, 'sort');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('正式知识发布令牌只保存哈希、按 sourceId 幂等并保留版本', async () => {
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

    const publishBody = {
      sourceId: 'kb:versioned',
      type: 'framework',
      title: '稳定发布条目',
      content: '# 稳定发布条目\n\n第一版正文\n',
      tags: ['迁移'],
      sourceType: 'codex',
      sourceRef: 'knowledge-v2/test/versioned.md',
      relations: [{ sourceId: 'kb:versioned', targetSourceId: 'kb:other', type: 'related', label: '相关认知', status: 'confirmed' }],
      metadata: { sourceProject: '知识库V2', runId: 'test' },
    };
    const created = await request('/api/library/publish', publishToken, { method: 'POST', ...json(publishBody) });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    const entryId = createdPayload.entry.id as string;

    const duplicate = await request('/api/library/publish', publishToken, { method: 'POST', ...json(publishBody) });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).status, 'UNCHANGED');
    assert.equal(db.listLibraryEntryVersions(entryId, user.id).length, 1);

    const changed = await request('/api/library/publish', publishToken, { method: 'POST', ...json({ ...publishBody, content: `${publishBody.content}\n第二版修订\n` }) });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).status, 'UPDATED');
    assert.equal(db.listLibraryEntryVersions(entryId, user.id).length, 2);

    const tokenCannotReadWebApi = await request('/api/library?status=all', publishToken);
    assert.equal(tokenCannotReadWebApi.status, 401);
    const tokenCannotComment = await request(`/api/library/${entryId}/comments`, publishToken, { method: 'POST', ...json({ content: '越权评论' }) });
    assert.equal(tokenCannotComment.status, 401);

    const revoked = await request('/api/library/publish-token', userToken, { method: 'DELETE' });
    assert.equal(revoked.status, 200);
    const rejected = await request('/api/library/publish', publishToken, { method: 'POST', ...json(publishBody) });
    assert.equal(rejected.status, 401);

    const otherGenerated = await request('/api/integrations/library-token', otherToken, { method: 'POST' });
    assert.equal(otherGenerated.status, 200);
    const otherGeneratedPayload = await otherGenerated.json();
    const otherPublished = await request('/api/integrations/library', otherGeneratedPayload.token, { method: 'POST', ...json({
      ...publishBody,
      sourceId: 'kb:other-account',
      relations: [],
    }) });
    assert.equal(otherPublished.status, 201);
    const userListAfterOtherPublish = await request('/api/library?status=all', userToken);
    assert.equal((await userListAfterOtherPublish.json()).total, 2);
    const otherListAfterPublish = await request('/api/library?status=all', otherToken);
    assert.equal((await otherListAfterPublish.json()).total, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('发布令牌支持撤回、恢复和彻底清除，并清理当前双向关系', async () => {
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
    const publishToken = (await generated.json()).token as string;
    const targetBody = {
      sourceId: 'kb:lifecycle-target',
      type: 'reference',
      title: '生命周期目标',
      content: '# 生命周期目标\n\n目标正文\n',
      sourceType: 'codex',
      relations: [],
    };
    const sourceBody = {
      sourceId: 'kb:lifecycle-source',
      type: 'insight',
      title: '生命周期来源',
      content: '# 生命周期来源\n\n参见 [[生命周期目标]]。\n',
      sourceType: 'codex',
      relations: [{ sourceId: 'kb:lifecycle-source', targetSourceId: 'kb:lifecycle-target', type: 'related', label: '相关目标', status: 'confirmed' }],
    };
    const publishedTarget = await request('/api/integrations/library', publishToken, { method: 'POST', ...json(targetBody) });
    assert.equal(publishedTarget.status, 201);
    const publishedSource = await request('/api/integrations/library', publishToken, { method: 'POST', ...json(sourceBody) });
    assert.equal(publishedSource.status, 201);
    const sourceId = (await publishedSource.json()).entry.id as string;

    const retired = await request('/api/integrations/library/retire', publishToken, { method: 'POST', ...json({ sourceIds: ['kb:lifecycle-target'] }) });
    assert.equal(retired.status, 200);
    const retiredPayload = await retired.json();
    assert.equal(retiredPayload.items[0].status, 'RETIRED');
    assert.equal(retiredPayload.cleanedRelationCount, 1);

    const archivedTarget = await request('/api/library?status=archived', userToken);
    assert.equal((await archivedTarget.json()).items.some((item: { sourceId: string }) => item.sourceId === 'kb:lifecycle-target'), true);
    const sourceAfterRetire = await request(`/api/library/${sourceId}`, userToken);
    const sourceAfterRetirePayload = await sourceAfterRetire.json();
    assert.equal(sourceAfterRetirePayload.relations.items.length, 0);
    assert.match(sourceAfterRetirePayload.entry.html, /class="library-unresolved-link"/);
    assert.doesNotMatch(sourceAfterRetirePayload.entry.html, /class="library-internal-link"/);

    const restored = await request('/api/integrations/library/restore', publishToken, { method: 'POST', ...json({ sourceIds: ['kb:lifecycle-target'] }) });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).items[0].status, 'RESTORED');
    const republishedSource = await request('/api/integrations/library', publishToken, { method: 'POST', ...json(sourceBody) });
    assert.equal(republishedSource.status, 200);
    const restoredSource = await request(`/api/library/${sourceId}`, userToken);
    const restoredSourcePayload = await restoredSource.json();
    assert.equal(restoredSourcePayload.relations.items.length, 1);
    assert.match(restoredSourcePayload.entry.html, /class="library-internal-link"/);

    const purgeWithoutConfirmation = await request('/api/integrations/library/purge', publishToken, { method: 'POST', ...json({ sourceIds: ['kb:lifecycle-target'] }) });
    assert.equal(purgeWithoutConfirmation.status, 400);
    assert.equal((await purgeWithoutConfirmation.json()).error.code, 'PURGE_CONFIRMATION_REQUIRED');
    const purged = await request('/api/integrations/library/purge', publishToken, { method: 'POST', ...json({ sourceIds: ['kb:lifecycle-target'], confirm: true }) });
    assert.equal(purged.status, 200);
    assert.equal((await purged.json()).items[0].status, 'PURGED');
    const missingTarget = await request('/api/library?status=all&q=kb%3Alifecycle-target', userToken);
    assert.equal((await missingTarget.json()).total, 0);
    const sourceAfterPurge = await request(`/api/library/${sourceId}`, userToken);
    assert.equal((await sourceAfterPurge.json()).relations.items.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('详情页会把已存在的知识库标题解析为站内跳转链接', () => {
  const target = libraryService.createLibraryEntry(user.id, {
    kind: 'article',
    type: 'reference',
    sourceId: 'kb:internal-target',
    title: '可跳转目标',
    content: '# 可跳转目标\n\n目标正文\n',
    status: 'active',
    sourceType: 'codex',
    metadata: { legacyId: 'legacy-target', aliases: ['目标简称'] },
  });
  const source = libraryService.createLibraryEntry(user.id, {
    kind: 'article',
    type: 'insight',
    sourceId: 'kb:internal-source',
    title: '站内引用',
    content: '# 站内引用\n\n参见 [[可跳转目标]]、[[目标简称]] 和 [[#legacy-target]]。\n\n[[不存在的条目]]\n',
    sourceType: 'codex',
    relations: [{ sourceId: 'kb:internal-source', targetSourceId: 'kb:internal-target', type: 'related', label: '相关目标', status: 'confirmed' }],
  });
  const detail = libraryService.getLibraryDetail(user.id, source.entry.id);
  assert.ok(detail);
  assert.match(detail.entry.html || '', new RegExp(`<a class="library-internal-link" href="/library/${target.entry.id}">可跳转目标</a>`));
  assert.match(detail.entry.html || '', new RegExp(`<a class="library-internal-link" href="/library/${target.entry.id}">目标简称</a>`));
  assert.match(detail.entry.html || '', new RegExp(`<a class="library-internal-link" href="/library/${target.entry.id}">#legacy-target</a>`));
  assert.match(detail.entry.html || '', /class="library-unresolved-link"/);
  assert.equal(detail.relations.items[0].targetEntryId, target.entry.id);
  assert.equal(detail.relations.items[0].targetTitle, '可跳转目标');
});

test('知识库支持中文拼音名称排序和正倒序日期排序', () => {
  for (const title of ['排序样本 10', '排序样本 2', '排序样本 1']) {
    libraryService.createLibraryEntry(user.id, {
      kind: 'article',
      type: 'reference',
      title,
      content: `# ${title}\n\n排序测试正文。`,
      summary: '排序样本',
      status: 'active',
      sourceType: 'codex',
    });
  }
  const ascending = libraryService.listLibraryEntries(user.id, { q: '排序样本', sort: 'title_asc', pageSize: 10 });
  const descending = libraryService.listLibraryEntries(user.id, { q: '排序样本', sort: 'title_desc', pageSize: 10 });
  assert.deepEqual(ascending.items.map(item => item.title), ['排序样本 1', '排序样本 2', '排序样本 10']);
  assert.deepEqual(descending.items.map(item => item.title), ['排序样本 10', '排序样本 2', '排序样本 1']);
  const createdAsc = libraryService.listLibraryEntries(user.id, { q: '排序样本', sort: 'created_asc', pageSize: 10 });
  const createdDesc = libraryService.listLibraryEntries(user.id, { q: '排序样本', sort: 'created_desc', pageSize: 10 });
  assert.equal(createdAsc.items[0].createdAt <= createdAsc.items.at(-1)!.createdAt, true);
  assert.equal(createdDesc.items[0].createdAt >= createdDesc.items.at(-1)!.createdAt, true);
});

test('Markdown 渲染不信任原始 HTML 和危险链接', () => {
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
