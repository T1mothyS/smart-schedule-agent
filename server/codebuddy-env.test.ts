import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodeBuddyEnv } from './codebuddy-env.js';

test('每位用户的 CodeBuddy 环境相互隔离且不会写入进程环境', () => {
  const before = process.env.CODEBUDDY_API_KEY;
  const first = buildCodeBuddyEnv({ api_key: 'user-a-key', base_url: 'https://a.example' });
  const second = buildCodeBuddyEnv({ api_key: 'user-b-key' });

  assert.equal(first.CODEBUDDY_API_KEY, 'user-a-key');
  assert.equal(first.CODEBUDDY_BASE_URL, 'https://a.example');
  assert.equal(second.CODEBUDDY_API_KEY, 'user-b-key');
  assert.equal(second.CODEBUDDY_BASE_URL, undefined);
  assert.equal(process.env.CODEBUDDY_API_KEY, before);
});
