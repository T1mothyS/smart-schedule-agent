import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  dailyReportMediaPath,
  localizeDailyDigestImages,
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
});

test('HTTP 403、HTML 响应和错误图片内容都降级为无图，不把上游地址写入日报', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-invalid-'));
  const htmlUrl = 'https://images.example/html';
  const forbiddenUrl = 'https://images.example/forbidden';
  const invalidImageUrl = 'https://images.example/invalid';
  const localized = await localizeDailyDigestImages(markdownFor(htmlUrl, forbiddenUrl, invalidImageUrl), {
    mediaRoot,
    publicOrigin: 'https://gotimothy.online',
    lookup: publicLookup,
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
});

test('服务端下载图片前拒绝本机和内网地址', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-media-ssrf-'));
  let fetchCalls = 0;
  const localized = await localizeDailyDigestImages(markdownFor('http://127.0.0.1:8080/private.jpg', 'https://metadata.google.internal/token'), {
    mediaRoot,
    publicOrigin: 'https://gotimothy.online',
    lookup: async () => [{ address: '93.184.216.34', family: 4 as const }],
    fetcher: async () => {
      fetchCalls += 1;
      return new Response(onePixelPng, { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal((localized.match(/图片：—/g) || []).length, 2);
  assert.deepEqual(fs.readdirSync(mediaRoot), []);
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
