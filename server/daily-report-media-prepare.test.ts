import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-prepare-'));
process.env.DATA_DIR = tempDir;
process.env.APP_URL = 'https://gotimothy.online/today';

const db = await import('./db.js');
const media = await import('./daily-report-media-service.js');
const prepare = await import('./daily-report-media-prepare-service.js');

await db.initDb();

const userId = 'media-prepare-user';
const now = new Date().toISOString();
db.createUser({
  id: userId,
  email: 'media-prepare@example.com',
  password_hash: 'test-only',
  role: 'user',
  disabled: 0,
  created_at: now,
  updated_at: now,
});

const lookup = async () => [{ address: '93.184.216.34', family: 4 as const }];
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const secondPng = Buffer.concat([onePixelPng, Buffer.from('second-image')]);

function response(body: BodyInit, status = 200, contentType = 'image/png'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

test('media_prepare 按候选顺序回退、哈希去重并返回可核验托管结果', async () => {
  const mediaRoot = path.join(tempDir, 'fallback-media');
  const calls: string[] = [];
  const batch = prepare.createDailyReportMediaPrepareBatch(userId, '2026-09-13');
  const result = await prepare.prepareDailyReportMedia(userId, batch.mediaBatchId, [
    {
      assetKey: 'hero-1',
      candidates: [
        { url: 'https://images.example/forbidden', sourceUrl: 'https://news.example/hero', sourceDomain: 'news.example' },
        { url: 'https://images.example/html', sourceUrl: 'https://news.example/hero' },
        { url: 'https://images.example/hero.png', sourceUrl: 'https://news.example/hero' },
      ],
    },
    {
      assetKey: 'category-ai',
      candidates: [{ url: 'https://cdn.example/same.png', sourceUrl: 'https://news.example/ai' }],
    },
  ], {
    mediaRoot,
    lookup,
    publicOrigin: 'https://gotimothy.online',
    fetcher: async input => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/forbidden')) return response('forbidden', 403, 'text/plain');
      if (url.endsWith('/html')) return response('<html>not an image</html>', 200, 'image/png');
      return response(onePixelPng);
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.batch.hostedCount, 2);
  assert.equal(result.batch.failedCount, 0);
  assert.equal(result.batch.totalBytes, onePixelPng.length);
  assert.equal(calls.length, 4);
  const hero = result.assets.find(asset => asset.assetKey === 'hero-1')!;
  assert.equal(hero.status, 'HOSTED');
  assert.equal(hero.selectedCandidate, 3);
  assert.equal(hero.attempts[0].reason, 'HTTP_ERROR');
  assert.equal(hero.attempts[0].httpStatus, 403);
  assert.equal(hero.attempts[1].reason, 'INVALID_MIME');
  assert.match(hero.hostedUrl!, /^https:\/\/gotimothy\.online\/daily-report-media\/[a-f0-9]{64}\.png$/);
  assert.equal(hero.sha256, crypto.createHash('sha256').update(onePixelPng).digest('hex'));
  assert.deepEqual(fs.readdirSync(mediaRoot), [`${hero.sha256}.png`]);
  assert.deepEqual(prepare.getDailyReportMediaPrepareStatus(userId, batch.mediaBatchId).assets.map(asset => asset.status), ['HOSTED', 'HOSTED']);
});

test('media_prepare 允许失败 assetKey 后续重试，全部失败不会自动降级为 READY', async () => {
  const mediaRoot = path.join(tempDir, 'retry-media');
  const batch = prepare.createDailyReportMediaPrepareBatch(userId, '2026-09-14');
  const failed = await prepare.prepareDailyReportMedia(userId, batch.mediaBatchId, [
    { assetKey: 'lead-1', candidates: [{ url: 'https://images.example/missing' }, { url: 'https://images.example/also-missing' }] },
  ], {
    mediaRoot,
    lookup,
    fetcher: async () => response('missing', 404, 'text/plain'),
  });
  assert.equal(failed.status, 'PREPARING');
  assert.equal(failed.assets[0].status, 'FAILED');
  assert.equal(failed.assets[0].attempts.length, 2);

  const recovered = await prepare.prepareDailyReportMedia(userId, batch.mediaBatchId, [
    { assetKey: 'lead-1', candidates: [{ url: 'https://images.example/replacement.png' }] },
  ], {
    mediaRoot,
    lookup,
    fetcher: async () => response(secondPng),
  });
  assert.equal(recovered.status, 'READY');
  assert.equal(recovered.assets[0].selectedCandidate, 1);
  assert.equal(recovered.assets[0].sha256, crypto.createHash('sha256').update(secondPng).digest('hex'));
});

test('media_prepare 在批次总大小超过 30 MiB 时拒绝新增文件并保留已成功媒体', async () => {
  const mediaRoot = path.join(tempDir, 'batch-limit-media');
  const batch = prepare.createDailyReportMediaPrepareBatch(userId, '2026-09-14');
  const assets = Array.from({ length: 7 }, (_, index) => ({
    assetKey: `image-${index + 1}`,
    candidates: [{ url: `https://images.example/large-${index + 1}.png` }],
  }));
  const result = await prepare.prepareDailyReportMedia(userId, batch.mediaBatchId, assets, {
    mediaRoot,
    lookup,
    fetcher: async input => {
      const index = Number(String(input).match(/large-(\d+)/)?.[1] || 1);
      const body = Buffer.alloc(media.DAILY_REPORT_MEDIA_MAX_BYTES);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(body);
      body[body.length - 1] = index;
      return response(body);
    },
  });
  assert.equal(result.batch.hostedCount, 6);
  assert.equal(result.batch.failedCount, 1);
  assert.equal(result.batch.totalBytes, prepare.DAILY_REPORT_MEDIA_BATCH_MAX_TOTAL_BYTES);
  assert.equal(result.assets[6].attempts[0].reason, 'BATCH_TOTAL_LIMIT');
  assert.equal(fs.readdirSync(mediaRoot).length, 6);
});

test('受控抓图记录 SSRF、重定向、签名和大小失败，不写入未通过校验的文件', async () => {
  const mediaRoot = path.join(tempDir, 'security-media');
  const batch = prepare.createDailyReportMediaPrepareBatch(userId, '2026-09-15');
  const oversized = Buffer.alloc(media.DAILY_REPORT_MEDIA_MAX_BYTES + 1, 1);
  let callCount = 0;
  const result = await prepare.prepareDailyReportMedia(userId, batch.mediaBatchId, [
    { assetKey: 'ssrf', candidates: [{ url: 'http://127.0.0.1/private.png' }] },
    { assetKey: 'redirect-ssrf', candidates: [{ url: 'https://images.example/redirect-private' }] },
    { assetKey: 'wrong-mime', candidates: [{ url: 'https://images.example/wrong-mime' }] },
    { assetKey: 'too-large', candidates: [{ url: 'https://images.example/too-large' }] },
  ], {
    mediaRoot,
    lookup,
    fetcher: async input => {
      callCount += 1;
      const url = String(input);
      if (url.endsWith('/redirect-private')) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private.png' } });
      if (url.endsWith('/wrong-mime')) return response('<html>fake</html>', 200, 'image/jpeg');
      if (url.endsWith('/too-large')) return response(oversized, 200, 'image/png');
      return response(onePixelPng);
    },
  });
  assert.equal(result.status, 'PREPARING');
  const byKey = new Map(result.assets.map(asset => [asset.assetKey, asset]));
  assert.equal(byKey.get('ssrf')!.attempts[0].reason, 'SSRF_BLOCKED');
  assert.equal(byKey.get('redirect-ssrf')!.attempts[0].reason, 'SSRF_BLOCKED');
  assert.equal(byKey.get('wrong-mime')!.attempts[0].reason, 'INVALID_MIME');
  assert.equal(byKey.get('too-large')!.attempts[0].reason, 'SIZE_LIMIT');
  assert.equal(callCount, 3);
  assert.equal(fs.existsSync(mediaRoot), false);
});

test('新媒体批次发布检查绑定用户、日期、runId、assetKey，并验证 Markdown 与文件真实内容', async () => {
  const mediaRoot = path.join(tempDir, 'publish-check-media');
  const batch = prepare.createDailyReportMediaPrepareBatch(userId, '2026-09-16');
  const prepared = await prepare.prepareDailyReportMedia(userId, batch.mediaBatchId, [
    { assetKey: 'hero-1', candidates: [{ url: 'https://images.example/hero.png' }] },
    { assetKey: 'category-1', candidates: [{ url: 'https://images.example/category.png' }] },
  ], {
    mediaRoot,
    lookup,
    publicOrigin: 'https://gotimothy.online',
    fetcher: async input => response(String(input).endsWith('/category.png') ? secondPng : onePixelPng),
  });
  const hero = prepared.assets.find(asset => asset.assetKey === 'hero-1')!;
  const category = prepared.assets.find(asset => asset.assetKey === 'category-1')!;
  const markdown = [
    '# Daily Digest',
    '<!-- daily-digest.v1 -->',
    `图片：${hero.hostedUrl}`,
    `图片：${category.hostedUrl}`,
  ].join('\n');

  assert.doesNotThrow(() => prepare.assertDailyReportMediaBatchReadyForPublish(userId, {
    mediaBatchId: batch.mediaBatchId,
    runId: batch.runId,
    reportDate: '2026-09-16',
    requiredAssetKeys: ['hero-1', 'category-1'],
    markdown,
  }, { mediaRoot, publicOrigin: 'https://gotimothy.online' }));
  assert.throws(
    () => prepare.assertDailyReportMediaBatchReadyForPublish(userId, {
      mediaBatchId: batch.mediaBatchId,
      runId: batch.runId,
      reportDate: '2026-09-16',
      requiredAssetKeys: ['hero-1'],
      markdown,
    }, { mediaRoot, publicOrigin: 'https://gotimothy.online' }),
    /没有对应的已授权媒体 assetKey/,
  );
  assert.throws(
    () => prepare.assertDailyReportMediaBatchReadyForPublish(userId, {
      mediaBatchId: batch.mediaBatchId,
      runId: 'wrong-run',
      reportDate: '2026-09-16',
      requiredAssetKeys: ['hero-1', 'category-1'],
      markdown,
    }, { mediaRoot, publicOrigin: 'https://gotimothy.online' }),
    /runId 不一致/,
  );
  fs.writeFileSync(path.join(mediaRoot, path.basename(new URL(hero.hostedUrl!).pathname)), 'tampered');
  assert.throws(
    () => prepare.assertDailyReportMediaBatchReadyForPublish(userId, {
      mediaBatchId: batch.mediaBatchId,
      runId: batch.runId,
      reportDate: '2026-09-16',
      requiredAssetKeys: ['hero-1', 'category-1'],
      markdown,
    }, { mediaRoot, publicOrigin: 'https://gotimothy.online' }),
    /文件校验失败/,
  );
});

test('媒体批次可以进入 PENDING_RETRY，并拒绝在非 READY 状态提交', async () => {
  const batch = prepare.createDailyReportMediaPrepareBatch(userId, '2026-09-17');
  const pending = prepare.markDailyReportMediaBatchPendingRetry(userId, batch.mediaBatchId, 'publish test failure');
  assert.equal(pending.status, 'PENDING_RETRY');
  assert.throws(() => prepare.commitDailyReportMediaBatch(userId, batch.mediaBatchId), /不能提交/);
});
