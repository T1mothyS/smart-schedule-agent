import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertHostedDailyReportMedia,
  dailyReportMediaPath,
  localizeDailyDigestImages,
  storeProvidedDailyReportMedia,
} from './daily-report-media-service.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }];
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function markdownFor(...urls: string[]): string {
  return [
    '# Daily Digest',
    '<!-- daily-digest.v1 -->',
    ...urls.map(url => `图片：${url}`),
  ].join('\n');
}

test('日报图片只下载一次，校验签名后以哈希文件保存并替换为本站 URL', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-valid-'));
  const sourceUrl = 'https://images.example/news.png';
  const calls: string[] = [];
  const localized = await localizeDailyDigestImages(markdownFor(sourceUrl, sourceUrl), {
    mediaRoot,
    publicOrigin: 'https://gotimothy.online',
    lookup: publicLookup,
    fetcher: async input => {
      calls.push(String(input));
      return new Response(onePixelPng, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(onePixelPng.length) },
      });
    },
  });

  const sha256 = crypto.createHash('sha256').update(onePixelPng).digest('hex');
  const expectedPath = `/daily-report-media/${sha256}.png`;
  assert.equal(calls.length, 1);
  assert.equal((localized.match(new RegExp(expectedPath.replaceAll('/', '\\/'), 'g')) || []).length, 2);
  assert.equal(fs.readFileSync(path.join(mediaRoot, `${sha256}.png`)).equals(onePixelPng), true);
  assert.equal(dailyReportMediaPath(expectedPath), expectedPath);
  assert.doesNotThrow(() => assertHostedDailyReportMedia(localized, mediaRoot, 'https://gotimothy.online'));
});

test('云端严格媒体模式同时托管来源 logo，并在任一媒体失败时阻止发布', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-cloud-'));
  const calls: string[] = [];
  const localized = await localizeDailyDigestImages(
    '# Daily Digest\n<!-- daily-digest.v1 -->\n## Lead Story\n### BBC headline\n来源：BBC\n时间：2026-09-09\n链接：https://news.example/story\n图片：https://images.example/news.png',
    {
      mediaRoot,
      publicOrigin: 'https://gotimothy.online',
      lookup: publicLookup,
      requireAllMedia: true,
      inferSourceLogos: true,
      fetcher: async input => {
        calls.push(String(input));
        return new Response(onePixelPng, { status: 200, headers: { 'content-type': 'image/png' } });
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.match(localized, /图片：https:\/\/gotimothy\.online\/daily-report-media\/[a-f0-9]{64}\.png/);
  assert.match(localized, /来源图标：https:\/\/gotimothy\.online\/daily-report-media\/[a-f0-9]{64}\.png/);

  await assert.rejects(
    () => localizeDailyDigestImages(markdownFor('https://images.example/unavailable.png'), {
      mediaRoot,
      publicOrigin: 'https://gotimothy.online',
      lookup: publicLookup,
      requireAllMedia: true,
      fetcher: async () => new Response('unavailable', { status: 503 }),
    }),
    /无法全部托管/,
  );
});

test('HTTP 403、HTML 响应和错误图片内容都降级为无图，不把上游地址写入日报', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-invalid-'));
  const htmlUrl = 'https://images.example/html';
  const forbiddenUrl = 'https://images.example/forbidden';
  const invalidImageUrl = 'https://images.example/invalid';
  const failures: Array<{ label: string; code: string; httpStatus?: number }> = [];
  const localized = await localizeDailyDigestImages(markdownFor(htmlUrl, forbiddenUrl, invalidImageUrl), {
    mediaRoot,
    publicOrigin: 'https://gotimothy.online',
    lookup: publicLookup,
    onFailure: failure => failures.push(failure),
    fetcher: async input => {
      const url = String(input);
      if (url.endsWith('/forbidden')) return new Response('<!DOCTYPE html>', { status: 403, headers: { 'content-type': 'text/html' } });
      if (url.endsWith('/invalid')) return new Response('not an image', { status: 200, headers: { 'content-type': 'image/jpeg' } });
      return new Response('<!DOCTYPE html>', { status: 200, headers: { 'content-type': 'text/html' } });
    },
  });

  assert.equal((localized.match(/图片：—/g) || []).length, 3);
  assert.doesNotMatch(localized, /images\.example/);
  assert.deepEqual(fs.readdirSync(mediaRoot), []);
  assert.equal(failures.length, 3);
  assert.equal(failures.filter(failure => failure.code === 'HTTP_ERROR' && failure.httpStatus === 403).length, 1);
  assert.equal(failures.filter(failure => failure.code === 'INVALID_MIME').length, 2);
});

test('服务端下载图片前拒绝本机和内网地址', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-ssrf-'));
  let fetchCalls = 0;
  const failures: Array<{ code: string }> = [];
  const localized = await localizeDailyDigestImages(markdownFor('http://127.0.0.1:8080/private.jpg', 'https://metadata.google.internal/token'), {
    mediaRoot,
    publicOrigin: 'https://gotimothy.online',
    lookup: async () => [{ address: '93.184.216.34', family: 4 as const }],
    onFailure: failure => failures.push(failure),
    fetcher: async () => {
      fetchCalls += 1;
      return new Response(onePixelPng, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal((localized.match(/图片：—/g) || []).length, 2);
  assert.deepEqual(fs.readdirSync(mediaRoot), []);
  assert.deepEqual(failures.map(failure => failure.code).sort(), ['SSRF_BLOCKED', 'SSRF_BLOCKED']);
});

test('没有 Daily Digest 标记的旧日报不触发图片下载', async () => {
  let fetchCalls = 0;
  const markdown = '# 旧日报\n\n图片：https://images.example/old.jpg';
  const localized = await localizeDailyDigestImages(markdown, {
    fetcher: async () => {
      fetchCalls += 1;
      return new Response(onePixelPng);
    },
  });
  assert.equal(localized, markdown);
  assert.equal(fetchCalls, 0);
});

test('本地上传的哈希媒体可被发布前检查识别，外站地址和缺失文件会被拒绝', () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-upload-'));
  const body = Buffer.concat([onePixelPng, Buffer.from('uploaded')]);
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const filename = `${sha256}.png`;
  const stored = storeProvidedDailyReportMedia(filename, body, 'image/png', mediaRoot);
  assert.equal(stored.filename, filename);
  assertHostedDailyReportMedia(`<!-- daily-digest.v1 -->\n图片：/daily-report-media/${filename}`, mediaRoot);
  assert.throws(
    () => assertHostedDailyReportMedia('<!-- daily-digest.v1 -->\n图片：https://images.example/news.png', mediaRoot),
    /必须先在本地上传/,
  );
  assert.throws(
    () => assertHostedDailyReportMedia(`<!-- daily-digest.v1 -->\n来源图标：/daily-report-media/${'f'.repeat(64)}.ico`, mediaRoot),
    /尚未上传/,
  );
});

test('上传接口接受常见 favicon ICO 和受限 SVG logo', () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-logo-'));
  const assets = [
    { body: Buffer.from([0, 0, 1, 0, 1, 0]), mime: 'image/x-icon', extension: '.ico' },
    { body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#0d5c4b"/></svg>'), mime: 'image/svg+xml', extension: '.svg' },
  ];
  for (const asset of assets) {
    const sha256 = crypto.createHash('sha256').update(asset.body).digest('hex');
    const stored = storeProvidedDailyReportMedia(`${sha256}${asset.extension}`, asset.body, asset.mime, mediaRoot);
    assert.equal(stored.mimeType, asset.mime);
    assertHostedDailyReportMedia(`<!-- daily-digest.v1 -->\n来源图标：/daily-report-media/${stored.filename}`, mediaRoot);
  }
});
