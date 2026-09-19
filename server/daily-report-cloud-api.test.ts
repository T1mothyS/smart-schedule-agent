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
const activity = await import('./activity-store.js');
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

const cloudMediaRoot = path.join(tempDir, 'daily-report-media');
fs.mkdirSync(cloudMediaRoot, { recursive: true });
const cloudMediaUrls = ['a', 'b', 'c', 'd', 'e'].map(letter => `/daily-report-media/${letter.repeat(64)}.jpg`);
const cloudMarketLogoUrl = `/daily-report-media/${'0'.repeat(64)}.jpg`;
for (const [index, letter] of ['a', 'b', 'c', 'd', 'e'].entries()) {
  fs.writeFileSync(path.join(cloudMediaRoot, `${letter.repeat(64)}.jpg`), `cloud-media-${index}`);
}
fs.writeFileSync(path.join(cloudMediaRoot, `${'0'.repeat(64)}.jpg`), 'cloud-market-logo');
const cloudMarkdown = [
  '# Daily Digest',
  '<!-- daily-digest.v1 -->',
  '## Today at a Glance',
  '1. 第一条公开资料重点足够清楚',
  '2. 第二条公开资料重点足够清楚',
  '3. 第三条公开资料重点足够清楚',
  '',
  '日期：2026-09-09',
  '今日主题：五条普通新闻组成三个以上可核验角度',
  '',
  '## Lead Story',
  '### Lead headline',
  '来源：Source One',
  '时间：2026-09-09',
  '链接：https://example.com/lead',
  `图片：${cloudMediaUrls[0]}`,
  '#### What happened / 发生了什么',
  '内容：公开资料记录了这条新闻的事实变化，并保留了必要的核验边界。',
  '#### Why it matters / 为什么重要',
  '内容：这会影响后续判断顺序，需要继续核对经营和风险信号。',
  '#### What to watch / 接下来关注什么',
  '内容：继续关注下一项可核验指标和明确时间节点。',
  '',
  '## Category Digest',
  '### Angle One',
  '#### Category headline one',
  '来源：Source Two',
  '时间：2026-09-09',
  '链接：https://example.com/one',
  `图片：${cloudMediaUrls[1]}`,
  '摘要：这条普通新闻提供了一个独立且可核验的观察角度。',
  '',
  '### Angle Two',
  '#### Category headline two',
  '来源：Source Three',
  '时间：2026-09-09',
  '链接：https://example.com/two',
  `图片：${cloudMediaUrls[2]}`,
  '摘要：这条普通新闻补充了第二个独立且可核验的观察角度。',
  '',
  '### Angle Three',
  '#### Category headline three',
  '来源：Source Four',
  '时间：2026-09-09',
  '链接：https://example.com/three',
  `图片：${cloudMediaUrls[3]}`,
  '摘要：这条普通新闻补充了第三个独立且可核验的观察角度。',
  '',
  '### Angle Four',
  '#### Category headline four',
  '来源：Source Five',
  '时间：2026-09-09',
  '链接：https://example.com/four',
  `图片：${cloudMediaUrls[4]}`,
  '摘要：这条普通新闻补充了第四个独立且可核验的观察角度。',
  '',
  '### 金融与市场',
  '#### 市场快照',
  '来源：Yahoo Finance chart',
  `来源图标：${cloudMarketLogoUrl}`,
  '时间：2026-09-09 15:00',
  '链接：https://finance.yahoo.com/',
  '摘要：市场数据按各自时间点记录，不计入普通新闻数量。',
  '',
  '## Worth Your Time',
  '## Footer',
  '由日报 V2 自动整理。',
].join('\n');
const cloudMarkdownWithSecurityWords = cloudMarkdown.replace(
  '今日主题：五条普通新闻组成三个以上可核验角度',
  '今日主题：五条关于 password reset、secret rotation 和 API key 生命周期的普通新闻组成三个以上可核验角度',
);

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
    const pendingRequest = db.getOAuthAuthorizationRequest(requestId!);
    assert.ok(pendingRequest);
    const pendingTtlMs = Date.parse(pendingRequest.expires_at) - Date.now();
    assert.ok(pendingTtlMs > (cloudAuth.DAILY_REPORT_CLOUD_AUTHORIZATION_REQUEST_TTL_SECONDS - 2) * 1000);
    assert.ok(pendingTtlMs <= cloudAuth.DAILY_REPORT_CLOUD_AUTHORIZATION_REQUEST_TTL_SECONDS * 1000);

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

    const upgradeVerifier = 'u'.repeat(43);
    const upgradeChallenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(upgradeVerifier))).toString('base64url');
    const upgradeScopes = ['daily_report:media_prepare', 'daily_report:media_probe'];
    const upgradeAuthorize = await request(`/oauth/authorize?response_type=code&client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent('https://chatgpt.example/callback')}&scope=${encodeURIComponent(upgradeScopes.join(' '))}&state=state-upgrade&code_challenge=${upgradeChallenge}&code_challenge_method=S256&resource=${encodeURIComponent('http://127.0.0.1:0/mcp')}`);
    assert.equal(upgradeAuthorize.status, 200);
    const upgradeLoginPage = await upgradeAuthorize.text();
    const upgradeRequestId = upgradeLoginPage.match(/name="request_id" value="([^"]+)"/)?.[1];
    const upgradeCsrf = upgradeLoginPage.match(/name="csrf" value="([^"]+)"/)?.[1];
    assert.ok(upgradeRequestId);
    assert.ok(upgradeCsrf);

    const upgradeLogin = await request('/oauth/authorize/login', formBody({
      request_id: upgradeRequestId!,
      csrf: upgradeCsrf!,
      email: user.email,
      password,
    }));
    assert.equal(upgradeLogin.status, 200);
    const upgradeConsentPage = await upgradeLogin.text();
    assert.match(upgradeConsentPage, /允许定时任务在登录后持续刷新授权/);
    const upgradedRequest = db.getOAuthAuthorizationRequest(upgradeRequestId!);
    assert.ok(upgradedRequest);
    assert.match(upgradedRequest!.scope, /daily_report:media_prepare/);
    assert.match(upgradedRequest!.scope, /daily_report:media_probe/);
    assert.match(upgradedRequest!.scope, /offline_access/);

    const upgradeConsent = await request('/oauth/authorize/consent', {
      ...formBody({ request_id: upgradeRequestId!, csrf: upgradeCsrf!, approved: 'true' }),
      redirect: 'manual',
    });
    assert.equal(upgradeConsent.status, 302);
    const upgradeCallback = new URL(upgradeConsent.headers.get('location')!);
    const upgradeCode = upgradeCallback.searchParams.get('code');
    assert.equal(upgradeCallback.searchParams.get('state'), 'state-upgrade');
    assert.ok(upgradeCode);

    const upgradeTokenResponse = await request('/oauth/token', formBody({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: 'https://chatgpt.example/callback',
      code: upgradeCode!,
      code_verifier: upgradeVerifier,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(upgradeTokenResponse.status, 200);
    const upgradeTokenBody = await upgradeTokenResponse.json() as { scope: string; refresh_token?: string };
    assert.ok(upgradeTokenBody.refresh_token);
    assert.match(upgradeTokenBody.scope, /daily_report:media_prepare/);
    assert.match(upgradeTokenBody.scope, /daily_report:media_probe/);
    assert.match(upgradeTokenBody.scope, /offline_access/);

    const upgradeRefreshResponse = await request('/oauth/token', formBody({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: upgradeTokenBody.refresh_token!,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(upgradeRefreshResponse.status, 200);
    const upgradeRefreshBody = await upgradeRefreshResponse.json() as { refresh_token: string; scope: string };
    assert.equal(upgradeRefreshBody.refresh_token, upgradeTokenBody.refresh_token);
    assert.match(upgradeRefreshBody.scope, /daily_report:media_prepare/);
    assert.match(upgradeRefreshBody.scope, /daily_report:media_probe/);

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
    assert.equal(toolsBody.result.tools.length, 11);
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
      'daily_report.media_probe_start': ['daily_report:media_probe'],
      'daily_report.media_probe_status': ['daily_report:media_probe'],
      'daily_report.media_prepare_start': ['daily_report:media_prepare'],
      'daily_report.media_prepare': ['daily_report:media_prepare'],
      'daily_report.media_prepare_status': ['daily_report:media_prepare'],
    };
    for (const tool of toolsBody.result.tools as Array<any>) {
      assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: toolScopes[tool.name] }]);
    }

    const mediaPrepareStart = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 25, method: 'tools/call', params: {
        name: 'daily_report.media_prepare_start',
        arguments: { date: '2026-09-10' },
      } }),
    });
    assert.equal(mediaPrepareStart.status, 200);
    const mediaPrepareStartBody = await mediaPrepareStart.json() as any;
    assert.equal(mediaPrepareStartBody.result.structuredContent.status, 'PREPARING');
    assert.equal(mediaPrepareStartBody.result.structuredContent.assetCount, 0);
    assert.equal(mediaPrepareStartBody.result.structuredContent.limits.maxBytesPerFile, 5 * 1024 * 1024);

    const mediaPrepareStatus = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 26, method: 'tools/call', params: {
        name: 'daily_report.media_prepare_status',
        arguments: { mediaBatchId: mediaPrepareStartBody.result.structuredContent.mediaBatchId },
      } }),
    });
    assert.equal(mediaPrepareStatus.status, 200);
    const mediaPrepareStatusBody = await mediaPrepareStatus.json() as any;
    assert.equal(mediaPrepareStatusBody.result.structuredContent.status, 'PREPARING');
    assert.equal(mediaPrepareStatusBody.result.structuredContent.batch.runId, mediaPrepareStartBody.result.structuredContent.runId);

    const contextCall = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'daily_report.read_context', arguments: {} } }),
    });
    assert.equal(contextCall.status, 200);
    const contextBody = await contextCall.json() as any;
    assert.equal(contextBody.result.structuredContent.context.context.profile.name, 'Cloud test');

    const inputsCall = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'daily_report.read_inputs', arguments: { date: '2026-09-09' } } }),
    });
    assert.equal(inputsCall.status, 200);
    const inputsBody = await inputsCall.json() as any;
    assert.equal(inputsBody.result.structuredContent.markdownContract.contractVersion, '2026-09-19.1');
    assert.match(inputsBody.result.structuredContent.markdownContract.markdownTemplate, /#### What happened \/ 发生了什么/);
    assert.deepEqual(inputsBody.result.structuredContent.requirements, {
      unreadMailCount: 0,
      mailReadStatus: 'UNAVAILABLE',
      requiredCategories: ['金融与市场'],
      watchlistStockCount: 0,
      calendarScheduleCount: 0,
    });

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
    const notificationsBeforeDryRun = activity.listNotifications(userId).length;

    const previousBatchRequirement = process.env.CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED;
    process.env.CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED = 'true';
    try {
      const gatedPublish = await request('/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'batch-required', method: 'tools/call', params: {
          name: 'daily_report.publish',
          arguments: { date: '2026-09-09', markdown: cloudMarkdownWithSecurityWords, dry_run: true },
        } }),
      });
      assert.equal(gatedPublish.status, 200);
      const gatedBody = await gatedPublish.json() as any;
      assert.equal(gatedBody.result.isError, true);
      assert.match(gatedBody.result.content?.[0]?.text || '', /必须先准备 mediaBatchId/);
    } finally {
      if (previousBatchRequirement === undefined) delete process.env.CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED;
      else process.env.CLOUD_DAILY_REPORT_MEDIA_BATCH_REQUIRED = previousBatchRequirement;
    }

    const dryRun = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: cloudMarkdownWithSecurityWords, dry_run: true },
      } }),
    });
    assert.equal(dryRun.status, 200);
    const dryRunBody = await dryRun.json() as any;
    assert.equal(dryRunBody.result.structuredContent.status, 'VALIDATED_NOT_PUBLISHED');
    assert.equal(dryRunBody.result.structuredContent.imageCount, 5);
    assert.equal(dryRunBody.result.structuredContent.mediaCount, 6);
    assert.equal(dryRunBody.result.structuredContent.featuredHeadline, 'Lead headline');
    assert.equal(dryRunBody.result.structuredContent.featuredImageUrl, `http://127.0.0.1:0${cloudMediaUrls[0]}`);
    assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBeforeDryRun);
    assert.equal(activity.listNotifications(userId).length, notificationsBeforeDryRun);

    // Yahoo 的来源名称保留原样；不应自动下载 favicon 来阻止完整日报发布。
    const withoutOptionalLogo = cloudMarkdownWithSecurityWords.replace(`来源图标：${cloudMarketLogoUrl}\n`, '');
    const noLogoRun = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'without-optional-logo', method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: withoutOptionalLogo, dry_run: true },
      } }),
    });
    const noLogoBody = await noLogoRun.json() as any;
    assert.equal(noLogoBody.result.structuredContent.status, 'VALIDATED_NOT_PUBLISHED');
    assert.equal(noLogoBody.result.structuredContent.imageCount, 5);
    assert.equal(noLogoBody.result.structuredContent.logoCount, 0);
    assert.equal(noLogoBody.result.structuredContent.mediaCount, 5);
    assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBeforeDryRun);
    assert.equal(activity.listNotifications(userId).length, notificationsBeforeDryRun);

    const credentialMarkdown = cloudMarkdownWithSecurityWords.replace(
      'password reset',
      'password=abc12345',
    );
    const credentialRun = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 44, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: credentialMarkdown, dry_run: true },
      } }),
    });
    assert.equal(credentialRun.status, 200);
    const credentialBody = await credentialRun.json() as any;
    assert.equal(credentialBody.result.isError, true);
    assert.match(credentialBody.result.content?.[0]?.text || '', /凭据或本地路径安全检查/);
    assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBeforeDryRun);
    assert.equal(activity.listNotifications(userId).length, notificationsBeforeDryRun);

    const twoImageMarkdown = cloudMarkdown
      .replaceAll(cloudMediaUrls[2], cloudMediaUrls[0])
      .replaceAll(cloudMediaUrls[3], cloudMediaUrls[0])
      .replaceAll(cloudMediaUrls[4], cloudMediaUrls[1]);
    const twoImageRun = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: twoImageMarkdown, dry_run: true },
      } }),
    });
    assert.equal(twoImageRun.status, 200);
    const twoImageBody = await twoImageRun.json() as any;
    assert.equal(twoImageBody.result.structuredContent.status, 'VALIDATED_NOT_PUBLISHED');
    assert.equal(twoImageBody.result.structuredContent.imageCount, 2);
    assert.equal(twoImageBody.result.structuredContent.logoCount, 1);
    assert.equal(twoImageBody.result.structuredContent.mediaCount, 3);
    assert.equal(twoImageBody.result.structuredContent.mediaFailureCount, 0);
    assert.equal(activity.listNotifications(userId).length, notificationsBeforeDryRun);

    let allMediaFailedMarkdown = cloudMarkdown;
    for (const [original, replacement] of [
      [cloudMediaUrls[0], 'http://127.0.0.1:1/failure-a.jpg'],
      [cloudMediaUrls[1], 'http://127.0.0.1:1/failure-b.jpg'],
      [cloudMediaUrls[2], 'http://127.0.0.1:1/failure-c.jpg'],
      [cloudMediaUrls[3], 'http://127.0.0.1:1/failure-d.jpg'],
      [cloudMediaUrls[4], 'http://127.0.0.1:1/failure-e.jpg'],
    ] as const) {
      allMediaFailedMarkdown = allMediaFailedMarkdown.replaceAll(original, replacement);
    }
    allMediaFailedMarkdown = allMediaFailedMarkdown.replace('来源图标：' + cloudMarketLogoUrl + '\n', '');
    const allMediaFailedRun = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tokenBody.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'all-media-failed', method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: allMediaFailedMarkdown, dry_run: true },
      } }),
    });
    assert.equal(allMediaFailedRun.status, 200);
    const allMediaFailedBody = await allMediaFailedRun.json() as any;
    assert.equal(allMediaFailedBody.result.structuredContent.status, 'VALIDATED_NOT_PUBLISHED');
    assert.equal(allMediaFailedBody.result.structuredContent.candidateMediaCount, 5);
    assert.equal(allMediaFailedBody.result.structuredContent.candidateImageCount, 5);
    assert.equal(allMediaFailedBody.result.structuredContent.mediaCount, 0);
    assert.equal(allMediaFailedBody.result.structuredContent.imageCount, 0);
    assert.equal(allMediaFailedBody.result.structuredContent.mediaFailureCount, 5);
    assert.ok(allMediaFailedBody.result.structuredContent.warnings.includes('NO_IMAGES'));
    assert.equal(allMediaFailedBody.result.structuredContent.mediaReceipt.mediaFailureCount, 5);
    assert.deepEqual(
      [...new Set(allMediaFailedBody.result.structuredContent.mediaFailures.map((failure: any) => failure.code))],
      ['SSRF_BLOCKED'],
    );
    assert.equal(allMediaFailedBody.result.structuredContent.featuredImageUrl, '');
    assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBeforeDryRun);
    assert.equal(activity.listNotifications(userId).length, notificationsBeforeDryRun);

    const missingMediaMarkdown = cloudMarkdown.replace(
      cloudMediaUrls[4],
      `/daily-report-media/${'f'.repeat(64)}.jpg`,
    );
    const missingMediaRun = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 43, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: missingMediaMarkdown, dry_run: true },
      } }),
    });
    assert.equal(missingMediaRun.status, 200);
    const missingMediaBody = await missingMediaRun.json() as any;
    assert.equal(missingMediaBody.result.isError, true);
    assert.match(missingMediaBody.result.content?.[0]?.text || '', /尚未上传/);
    assert.equal(activity.listNotifications(userId).length, notificationsBeforeDryRun);

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
    const invalidResult = (await failedPublish.json() as any).result;
    assert.equal(invalidResult.isError, true);
    assert.equal(invalidResult.structuredContent.code, 'INVALID_DIGEST_FORMAT');
    assert.equal(invalidResult.structuredContent.validationIssues[0].path, 'date');
    assert.ok(!JSON.stringify(invalidResult).includes('127.0.0.1/internal.png'));
    assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBeforeDryRun);

    const published = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: {
        name: 'daily_report.publish',
        arguments: { date: '2026-09-09', markdown: cloudMarkdownWithSecurityWords, dry_run: false },
      } }),
    });
    assert.equal(published.status, 200);
    const publishedBody = await published.json() as any;
    assert.equal(publishedBody.result.structuredContent.status, 'PUBLISHED');
    assert.equal(publishedBody.result.structuredContent.source, 'cloud');
    assert.equal(publishedBody.result.structuredContent.deliveryStatus, 'CANDIDATE');
    assert.match(publishedBody.result.structuredContent.contentHash, /^[0-9a-f]{64}$/);
    const storedCloud = activity.getLatestDailyReportCandidate(userId, '2026-09-09', 'cloud');
    assert.ok(storedCloud);
    assert.equal(storedCloud.source, 'cloud');
    assert.equal(storedCloud.deliveryStatus, 'candidate');
    assert.equal(storedCloud.contentHash, publishedBody.result.structuredContent.contentHash);
    assert.equal(storedCloud.mediaReceipt?.imageCount, 5);
    assert.ok(cloudStore.listDailyReportCloudHistory(userId, 30).some(item => item.source === 'cloud' && item.deliveryStatus === 'CANDIDATE'));
    assert.equal(activity.listNotifications(userId).length, notificationsBeforeDryRun);

    const refreshed = await request('/oauth/token', formBody({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokenBody.refresh_token!,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(refreshed.status, 200);
    const refreshedBody = await refreshed.json() as { access_token: string; refresh_token: string };
    assert.notEqual(refreshedBody.access_token, tokenBody.access_token);
    assert.equal(refreshedBody.refresh_token, tokenBody.refresh_token);

    const secondRefresh = await request('/oauth/token', formBody({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokenBody.refresh_token!,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(secondRefresh.status, 200);
    const secondRefreshBody = await secondRefresh.json() as { access_token: string; refresh_token: string };
    assert.notEqual(secondRefreshBody.access_token, refreshedBody.access_token);
    assert.equal(secondRefreshBody.refresh_token, tokenBody.refresh_token);

    const revoked = await request('/oauth/revoke', formBody({ token: secondRefreshBody.access_token }));
    assert.equal(revoked.status, 200);
    const rejected = await request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secondRefreshBody.access_token}`, 'Content-Type': 'application/json' },
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
      refresh_token: secondRefreshBody.refresh_token,
      resource: 'http://127.0.0.1:0/mcp',
    }));
    assert.equal(disabledRefresh.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
