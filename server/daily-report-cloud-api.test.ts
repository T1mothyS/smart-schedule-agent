import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-cloud-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';

const api = await import('./index.js');
const db = await import('./db.js');
const cloudAuth = await import('./daily-report-cloud-auth.js');
const cloudStore = await import('./daily-report-cloud-store.js');
const backups = await import('./backup-service.js');

await api.initializeServer();

const userId = 'cloud-api-user';
const now = new Date().toISOString();
const password = 'cloud-test-password';
const user = db.createUser({
  id: userId,
  email: 'cloud-api@example.com',
  password_hash: bcrypt.hashSync(password, 4),
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});
db.upsertReminder({
  id: `reminder-${userId}`,
  user_id: userId,
  enabled: 0,
  hour: 8,
  minute: 0,
  reminder_email: user.email,
  created_at: now,
  updated_at: now,
});
cloudStore.replaceDailyReportCloudContext(userId, {
  profile: { name: 'Cloud test' },
  preferences: { focus: ['security'] },
});

test('日报云端 Context 会进入加密用户备份，但不备份 OAuth 令牌', () => {
  const password = 'cloud-context-backup-password';
  const encrypted = backups.createUserBackup(userId, password);
  const payload = backups.decryptBackup<Record<string, unknown>>(encrypted, password);
  const inspected = backups.inspectUserBackup(encrypted, password) as any;
  assert.equal(inspected.counts.dailyReportCloudContext, 1);
  assert.equal('oauthAccessTokens' in payload, false);
  assert.equal('oauthRefreshTokens' in payload, false);

  cloudStore.replaceDailyReportCloudContext(userId, { profile: { name: 'Changed locally' } });
  const restored = backups.restoreUserBackup(userId, encrypted, password, 'replace') as any;
  assert.equal(restored.dailyReportCloudContext, true);
  assert.equal((cloudStore.getDailyReportCloudContext(userId).context.profile as { name: string }).name, 'Cloud test');
});

test('日报云端 Context 拒绝本地路径和凭据字段', () => {
  assert.throws(
    () => cloudStore.replaceDailyReportCloudContext(userId, { localFile: 'C:\\Users\\Elysia\\private.txt' }),
    /本地路径/,
  );
  assert.throws(
    () => cloudStore.replaceDailyReportCloudContext(userId, { api_token: 'should-not-be-saved' }),
    /凭据字段/,
  );
});

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

function formBody(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  };
}

test('ChatGPT Work Cloud OAuth、MCP 与 Context 账号隔离链路可用', async () => {
  const server = http.createServer(api.app);
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (pathname: string, init: RequestInit = {}) => fetch(baseUrl + pathname, init);

  try {
    const metadata = await request('/.well-known/oauth-authorization-server');
    assert.equal(metadata.status, 200);
    const metadataBody = await metadata.json() as Record<string, unknown>;
    assert.equal(metadataBody.token_endpoint, 'http://127.0.0.1:0/oauth/token');

    const registration = await request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT Work test',
        redirect_uris: ['https://chatgpt.example/callback'],
      }),
    });
    assert.equal(registration.status, 201);
    const client = await registration.json() as { client_id: string };
    assert.match(client.client_id, /^drc_/);

    const verifier = 'v'.repeat(43);
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
    const authorize = await request(`/oauth/authorize?response_type=code&client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent('https://chatgpt.example/callback')}&scope=${encodeURIComponent(cloudAuth.DAILY_REPORT_CLOUD_SCOPES.join(' '))}&state=state-1&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent('http://127.0.0.1:0/mcp')}`);
    assert.equal(authorize.status, 200);
    const loginPage = await authorize.text();
    const requestId = loginPage.match(/name="request_id" value="([^"]+)"/)?.[1];
    const csrf = loginPage.match(/name="csrf" value="([^"]+)"/)?.[1];
    assert.ok(requestId);
    assert.ok(csrf);

    const login = await request('/oauth/authorize/login', formBody({
      request_id: requestId!,
      csrf: csrf!,
      email: user.email,
      password,
    }));
    assert.equal(login.status, 200);
    const consentPage = await login.text();
    assert.match(consentPage, /确认日报云端授权/);

    const consent = await request('/oauth/authorize/consent', {
      ...formBody({ request_id: requestId!, csrf: csrf!, approved: 'true' }),
      redirect: 'manual',
    });
    assert.equal(consent.status, 302);
    const redirectLocation = consent.headers.get('location');
    assert.ok(redirectLocation);
    const callback = new URL(redirectLocation!);
    const code = callback.searchParams.get('code');
    assert.equal(callback.searchParams.get('state'), 'state-1');
    assert.ok(code);

    const tokenResponse = await request('/oauth/token', formBody({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: 'https://chatgpt.example/callback',
      code: code!,
      code_verifier: verifier,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(tokenResponse.status, 200);
    const tokenBody = await tokenResponse.json() as { access_token: string; refresh_token?: string };
    assert.ok(tokenBody.access_token);
    assert.ok(tokenBody.refresh_token);

    const initialize = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: cloudAuth.DAILY_REPORT_CLOUD_MCP_PROTOCOL_VERSION } }),
    });
    assert.equal(initialize.status, 200);
    assert.equal((await initialize.json() as any).result.serverInfo.name, 'ai-calendar-daily-report');

    const tools = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    assert.equal(tools.status, 200);
    const toolsBody = await tools.json() as any;
    assert.equal(toolsBody.result.tools.length, 6);
    const toolScopes: Record<string, string[]> = {
      'daily_report.read_inputs': [
        'daily_report:read_calendar',
        'daily_report:read_mail',
        'daily_report:read_context',
        'daily_report:read_history',
      ],
      'daily_report.read_calendar': ['daily_report:read_calendar'],
      'daily_report.read_mail': ['daily_report:read_mail'],
      'daily_report.read_context': ['daily_report:read_context'],
      'daily_report.read_history': ['daily_report:read_history'],
      'daily_report.publish': ['daily_report:publish'],
    };
    for (const tool of toolsBody.result.tools as Array<any>) {
      assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: toolScopes[tool.name] }]);
    }

    const contextCall = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'daily_report.read_context', arguments: {} } }),
    });
    assert.equal(contextCall.status, 200);
    const contextBody = await contextCall.json() as any;
    assert.equal(contextBody.result.structuredContent.context.context.profile.name, 'Cloud test');

    const limitedAccessToken = crypto.randomBytes(32).toString('base64url');
    db.createOAuthAccessToken({
      token_hash: crypto.createHash('sha256').update(limitedAccessToken, 'utf8').digest('hex'),
      client_id: client.client_id,
      user_id: userId,
      scope: 'daily_report:read_history',
      resource: 'http://127.0.0.1:0/mcp',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    });
    const limitedPublish = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${limitedAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 35, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: '# Daily Digest\n<!-- daily-digest.v1 -->\n## Today at a Glance\n- should not publish' },
      } }),
    });
    assert.equal(limitedPublish.status, 200);
    const limitedPublishBody = await limitedPublish.json() as any;
    assert.equal(limitedPublishBody.result.isError, true);
    assert.ok(Array.isArray(limitedPublishBody.result._meta['mcp/www_authenticate']));
    assert.match(limitedPublishBody.result._meta['mcp/www_authenticate'][0], /scope="daily_report:publish"/);
    assert.match(limitedPublishBody.result._meta['mcp/www_authenticate'][0], /error="insufficient_scope"/);
    assert.match(limitedPublishBody.result._meta['mcp/www_authenticate'][0], /error_description="/);

    const historyBeforeDryRun = cloudStore.listDailyReportCloudHistory(userId, 30).length;

    const dryRun = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: '# Daily Digest\n<!-- daily-digest.v1 -->\n## Today at a Glance\n- cloud test', dry_run: true },
      } }),
    });
    assert.equal(dryRun.status, 200);
    assert.equal((await dryRun.json() as any).result.structuredContent.status, 'VALIDATED_NOT_PUBLISHED');
    assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBeforeDryRun);

    const failedPublish = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 40, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: {
          date: '2026-09-09',
          markdown: '# Daily Digest\n<!-- daily-digest.v1 -->\n## Today at a Glance\n图片：http://127.0.0.1/internal.png',
        },
      } }),
    });
    assert.equal(failedPublish.status, 200);
    assert.equal((await failedPublish.json() as any).result.isError, true);
    assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBeforeDryRun);

    const published = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: '# Daily Digest\n<!-- daily-digest.v1 -->\n## Today at a Glance\n- cloud test', dry_run: false },
      } }),
    });
    assert.equal(published.status, 200);
    assert.equal((await published.json() as any).result.structuredContent.status, 'PUBLISHED');

    const refreshed = await request('/oauth/token', formBody({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokenBody.refresh_token!,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(refreshed.status, 200);
    const refreshedBody = await refreshed.json() as { access_token: string; refresh_token: string };
    assert.notEqual(refreshedBody.access_token, tokenBody.access_token);
    assert.notEqual(refreshedBody.refresh_token, tokenBody.refresh_token);

    const replay = await request('/oauth/token', formBody({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokenBody.refresh_token!,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(replay.status, 400);

    const revoked = await request('/oauth/revoke', formBody({ token: refreshedBody.access_token }));
    assert.equal(revoked.status, 200);
    const rejected = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshedBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
    });
    assert.equal(rejected.status, 401);

    db.updateUserDisabled(userId, 1);
    const disabledAccess = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/list' }),
    });
    assert.equal(disabledAccess.status, 401);
    const disabledRefresh = await request('/oauth/token', formBody({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: refreshedBody.refresh_token,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(disabledRefresh.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
