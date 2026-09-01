import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryRateLimitStore, securityHeaders } from './http-security.js';

test('限流窗口内拒绝超额请求并在窗口结束后恢复', () => {
  const store = new InMemoryRateLimitStore();
  assert.equal(store.consume('login:one', 2, 1_000, 10_000).allowed, true);
  assert.equal(store.consume('login:one', 2, 1_000, 10_100).allowed, true);
  const rejected = store.consume('login:one', 2, 1_000, 10_200);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.equal(store.consume('login:one', 2, 1_000, 11_001).allowed, true);
});

test('不同限流键互不影响', () => {
  const store = new InMemoryRateLimitStore();
  store.consume('ai:user-a', 1, 1_000, 1);
  assert.equal(store.consume('ai:user-a', 1, 1_000, 2).allowed, false);
  assert.equal(store.consume('ai:user-b', 1, 1_000, 2).allowed, true);
});

test('限流键数量异常增长时会淘汰最早的桶', () => {
  const store = new InMemoryRateLimitStore();
  store.consume('first', 1, 60_000, 1);
  for (let index = 0; index < 10_000; index += 1) {
    store.consume(`key-${index}`, 1, 60_000, 1);
  }
  assert.equal(store.consume('first', 1, 60_000, 2).allowed, true);
});

test('生产日报 CSP 允许安全的 HTTPS 图片来源', () => {
  const headers = new Map<string, string>();
  let nextCalled = false;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  } as any;
  securityHeaders(true)({} as any, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.match(headers.get('Content-Security-Policy') || '', /img-src 'self' data: blob: https:/);
});
