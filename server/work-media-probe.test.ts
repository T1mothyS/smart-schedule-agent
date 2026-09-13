import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-work-media-probe-'));
process.env.DATA_DIR = tempDir;
process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'test';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
process.env.APP_URL = 'http://127.0.0.1:0';
process.env.WORK_MEDIA_PROBE_ENABLED = 'true';

const api = await import('./index.js');
const cloudMcp = await import('./daily-report-cloud-mcp.js');
const cloudStore = await import('./daily-report-cloud-store.js');
const activity = await import('./activity-store.js');
const probe = await import('./work-media-probe-service.js');

await api.initializeServer();

const userId = 'work-media-probe-user';
const auth = {
  userId,
  clientId: 'work-media-probe-client',
  scopes: ['daily_report:media_probe'],
  resource: 'http://127.0.0.1:0/mcp',
} as const;

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const tinyWebp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

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

const server = http.createServer(api.app);
const port = await listen(server);
const baseUrl = `http://127.0.0.1:${port}`;

async function startProbe(date = '2026-09-13'): Promise<any> {
  return cloudMcp.callTool(auth as any, 'daily_report.media_probe_start', { date });
}

async function upload(ticket: any, assetKey: string, body: Buffer, mime: string, filename = assetKey): Promise<Response> {
  return fetch(`${baseUrl}${probe.WORK_MEDIA_PROBE_ROUTE}/${ticket.probeId}/assets/${encodeURIComponent(assetKey)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ticket.upload.uploadToken}`,
      'Content-Type': mime,
      'X-Original-Filename': encodeURIComponent(filename),
    },
    body: new Uint8Array(body),
  });
}

test.after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Probe 通过 raw HTTP PUT 接收三种图片并回读核对 SHA-256，完全隔离正式媒体目录', async () => {
  const historyBefore = cloudStore.listDailyReportCloudHistory(userId, 30).length;
  const notificationsBefore = activity.listNotifications(userId).length;
  const ticket = await startProbe();
  assert.equal(ticket.status, 'PROBE_CREATED');
  assert.equal(ticket.transport, 'raw-http-put');
  assert.equal(ticket.limits.mcpRequestMaxBytes, 1_000_000);
  assert.equal(ticket.limits.maxBytesPerFile, 5 * 1024 * 1024);
  assert.equal(ticket.limits.maxFiles, 20);
  assert.equal(ticket.limits.maxTotalBytes, 15 * 1024 * 1024);
  assert.match(ticket.upload.urlTemplate, new RegExp(`${ticket.probeId}/assets/\\{assetKey\\}$`));

  const inputs = [
    ['jpeg', tinyJpeg, 'image/jpeg', '新闻图.jpg'],
    ['png', onePixelPng, 'image/png', '新闻图.png'],
    ['webp', tinyWebp, 'image/webp', '新闻图.webp'],
  ] as const;
  for (const [assetKey, body, mime, filename] of inputs) {
    const response = await upload(ticket, assetKey, body, mime, filename);
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.status, 'RECEIVED');
    assert.equal(result.completeRead, true);
    assert.equal(result.integrity, 'VERIFIED');
    assert.equal(result.originalFilename, filename);
    assert.equal(result.declaredMime, mime);
    assert.equal(result.detectedMime, mime);
    assert.equal(result.bytes, body.length);
    assert.equal(result.sha256, crypto.createHash('sha256').update(body).digest('hex'));
    assert.equal(result.probeId, ticket.probeId);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(tempDir.replaceAll('\\', '\\\\'), 'i'));
  }

  const status = await cloudMcp.callTool(auth as any, 'daily_report.media_probe_status', { probeId: ticket.probeId });
  assert.equal(status.status, 'OPEN');
  assert.equal(status.runId, ticket.runId);
  assert.equal(status.date, '2026-09-13');
  assert.equal(status.transport, 'raw-http-put');
  assert.equal(status.uploadedCount, 3);
  assert.equal(status.hashesVerified, 3);
  assert.equal(status.completeRead, true);
  assert.equal((status.files as any[]).length, 3);
  assert.equal((status.files as any[]).every(file => file.integrity === 'VERIFIED' && file.completeRead), true);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(tempDir.replaceAll('\\', '\\\\'), 'i'));

  const formalRoot = path.join(tempDir, 'daily-report-media');
  assert.deepEqual(fs.readdirSync(formalRoot), []);
  assert.ok(fs.existsSync(path.join(tempDir, 'work-media-probe', ticket.probeId)));
  assert.equal(cloudStore.listDailyReportCloudHistory(userId, 30).length, historyBefore);
  assert.equal(activity.listNotifications(userId).length, notificationsBefore);
});

test('Probe 拒绝空正文、错误图片、声明 MIME 不匹配、无票据和超大文件', async () => {
  const ticket = await startProbe();
  const invalidCases = [
    ['empty', Buffer.alloc(0), 'image/png', 400],
    ['html', Buffer.from('<html>not image</html>'), 'image/png', 400],
    ['mime-mismatch', onePixelPng, 'image/jpeg', 400],
  ] as const;
  for (const [assetKey, body, mime, expectedStatus] of invalidCases) {
    const response = await upload(ticket, assetKey, body, mime);
    assert.equal(response.status, expectedStatus);
    assert.match(String((await response.json() as any).error), /媒体|图片/);
  }

  const withoutToken = await fetch(`${baseUrl}${probe.WORK_MEDIA_PROBE_ROUTE}/${ticket.probeId}/assets/no-token`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png', 'X-Original-Filename': 'no-token.png' },
    body: new Uint8Array(onePixelPng),
  });
  assert.equal(withoutToken.status, 401);

  const oversized = Buffer.alloc(probe.WORK_MEDIA_PROBE_MAX_BYTES + 1);
  oversized.set(onePixelPng.subarray(0, 8), 0);
  const oversizedResponse = await upload(ticket, 'oversized', oversized, 'image/png');
  assert.equal(oversizedResponse.status, 413);
  assert.match(String((await oversizedResponse.json() as any).error), /5 MiB/);

  const status = await cloudMcp.callTool(auth as any, 'daily_report.media_probe_status', { probeId: ticket.probeId });
  assert.equal(status.uploadedCount, 0);
  assert.equal(status.totalBytes, 0);
});

test('Probe 的三份 5 MiB 文件可以达到批次上限，继续上传会被拒绝', async () => {
  const ticket = await startProbe();
  const exact = Buffer.alloc(probe.WORK_MEDIA_PROBE_MAX_BYTES);
  exact.set(onePixelPng.subarray(0, 8), 0);
  for (const assetKey of ['max-1', 'max-2', 'max-3']) {
    const response = await upload(ticket, assetKey, exact, 'image/png', `${assetKey}.png`);
    assert.equal(response.status, 200);
  }
  const overTotal = await upload(ticket, 'max-4', onePixelPng, 'image/png', 'max-4.png');
  assert.equal(overTotal.status, 413);
  assert.match(String((await overTotal.json() as any).error), /总大小/);

  const status = await cloudMcp.callTool(auth as any, 'daily_report.media_probe_status', { probeId: ticket.probeId });
  assert.equal(status.uploadedCount, 3);
  assert.equal(status.totalBytes, probe.WORK_MEDIA_PROBE_MAX_TOTAL_BYTES);
  assert.equal(status.hashesVerified, 3);
});

test('Probe 清理只处理自己的过期目录', () => {
  const stale = path.join(probe.workMediaProbeRoot(), 'stale-probe');
  fs.mkdirSync(stale, { recursive: true });
  const old = new Date(Date.now() - probe.WORK_MEDIA_PROBE_TTL_MS - 1000);
  fs.utimesSync(stale, old, old);
  probe.cleanupWorkMediaProbeStorage();
  assert.equal(fs.existsSync(stale), false);
  assert.ok(fs.existsSync(path.join(tempDir, 'daily-report-media')));
});
