import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp, registerSpaFallback } from './app.js';
import { createAuth, PAGE_SESSION_COOKIE } from './auth.js';
import { createProtectedToolsRouter, createToolsApiRouter } from './protected-tools.js';

function fixtureUser(overrides: Partial<{ disabled: number; auth_version: number }> = {}) {
  return {
    id: 'user-1', email: 'tools@example.invalid', role: 'user' as const, disabled: 0,
    auth_version: 0, created_at: '2026-09-17T00:00:00.000Z', updated_at: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

async function listen(app: ReturnType<typeof createApp>) {
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  return { listener, base: `http://127.0.0.1:${(listener.address() as { port: number }).port}` };
}

test('page session cookie uses an HttpOnly production policy and can be cleared', () => {
  const auth = createAuth({ secret: 'protected-tools-cookie-secret', isProduction: true, getUserById: () => undefined });
  const headers: string[] = [];
  const response = { append(name: string, value: string) { assert.equal(name, 'Set-Cookie'); headers.push(value); } } as any;

  auth.setPageSessionCookie(response, 'signed-token');
  assert.match(headers[0], /HttpOnly/);
  assert.match(headers[0], /SameSite=Lax/);
  assert.match(headers[0], /Secure/);
  assert.match(headers[0], /Max-Age=604800/);

  auth.clearPageSessionCookie(response);
  assert.match(headers[1], /Max-Age=0/);
  assert.match(headers[1], /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
});

test('Tools API only accepts Bearer and protected files reject bypass paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-protected-tools-'));
  const staticRoot = path.join(root, 'dist');
  fs.mkdirSync(path.join(root, 'allowed'), { recursive: true });
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: 1, tools: [
    { slug: 'allowed', title: '允许工具', summary: '受保护的测试工具', enabled: true, cspProfile: 'plotly-alipay' },
    { slug: 'disabled-tool', title: '禁用工具', summary: '不应公开', enabled: false },
  ] }));
  fs.writeFileSync(path.join(root, 'allowed', 'index.html'), '<!doctype html><script>window.toolLoaded=true</script>');
  fs.writeFileSync(path.join(root, 'allowed', 'asset.js'), 'window.assetLoaded=true');
  fs.writeFileSync(path.join(staticRoot, 'index.html'), 'synthetic SPA');
  let user = fixtureUser();
  const auth = createAuth({ secret: 'protected-tools-test-secret', getUserById: id => id === user.id ? user : undefined });
  const app = createApp({
    isProduction: true,
    isReady: () => true,
    staticPath: staticRoot,
    protectedTools: { root, authenticatePage: auth.authenticatePage, isReady: () => true },
  });
  app.use(createToolsApiRouter({ authenticate: auth.authenticate, root }));
  registerSpaFallback(app, staticRoot);
  const server = await listen(app);
  const token = auth.signUserToken(user);
  const cookie = `${PAGE_SESSION_COOKIE}=${encodeURIComponent(token)}`;
  try {
    const noApiAuth = await fetch(`${server.base}/api/tools`);
    assert.equal(noApiAuth.status, 401);
    const cookieApiAuth = await fetch(`${server.base}/api/tools`, { headers: { Cookie: cookie } });
    assert.equal(cookieApiAuth.status, 401);
    assert.deepEqual(await (await fetch(`${server.base}/api/tools`, { headers: { Authorization: `Bearer ${token}` } })).json(), {
      tools: [{ slug: 'allowed', title: '允许工具', summary: '受保护的测试工具', path: '/tools/allowed/', kind: 'mounted' }],
    });

    const noCookie = await fetch(`${server.base}/tools/allowed/`, { redirect: 'manual' });
    assert.equal(noCookie.status, 302);
    assert.match(noCookie.headers.get('location') || '', /^\/login\?next=/);
    assert.equal((await noCookie.text()).includes('window.toolLoaded'), false);

    const tool = await fetch(`${server.base}/tools/allowed/`, { headers: { Cookie: cookie } });
    assert.equal(tool.status, 200);
    assert.match(await tool.text(), /window\.toolLoaded/);
    assert.match(tool.headers.get('content-security-policy') || '', /script-src 'self' 'unsafe-inline' https:\/\/cdn\.plot\.ly/);
    assert.match(tool.headers.get('content-security-policy') || '', /frame-src https:\/\/render\.alipay\.com/);
    assert.equal(tool.headers.get('cache-control'), 'private, no-store');

    const asset = await fetch(`${server.base}/tools/allowed/asset.js`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /assetLoaded/);
    assert.equal((await fetch(`${server.base}/tools/allowed`, { headers: { Cookie: cookie }, redirect: 'manual' })).status, 308);
    assert.equal((await fetch(`${server.base}/tools/disabled-tool/`, { headers: { Cookie: cookie } })).status, 404);
    assert.equal((await fetch(`${server.base}/tools/unknown/`, { headers: { Cookie: cookie } })).status, 404);
    const traversal = await fetch(`${server.base}/tools/allowed/%2e%2e/index.html`, { headers: { Cookie: cookie } });
    assert.equal(traversal.status, 404);
    assert.notEqual(await traversal.text(), 'synthetic SPA');

    const hub = await fetch(`${server.base}/tools`, { headers: { Cookie: cookie } });
    assert.equal(hub.status, 200);
    assert.equal(await hub.text(), 'synthetic SPA');
    assert.match(hub.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.doesNotMatch(hub.headers.get('content-security-policy') || '', /script-src[^;]*unsafe-inline/);

    user = fixtureUser({ disabled: 1 });
    const disabled = await fetch(`${server.base}/tools/allowed/`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(disabled.status, 302);
    user = fixtureUser({ auth_version: 1 });
    const staleVersion = await fetch(`${server.base}/tools/allowed/`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(staleVersion.status, 302);
  } finally {
    await new Promise<void>(resolve => server.listener.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
