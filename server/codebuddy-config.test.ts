import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoLegacyCodeBuddyConfig } from './codebuddy-config.js';

test('服务拒绝服务器级 CodeBuddy 凭据，避免跨账号回退', () => {
  assert.doesNotThrow(() => assertNoLegacyCodeBuddyConfig({ APP_ENV: 'development' }));
  assert.throws(() => assertNoLegacyCodeBuddyConfig({ CODEBUDDY_API_KEY: 'legacy-key' }), /已废止服务器级/);
  assert.throws(() => assertNoLegacyCodeBuddyConfig({ CODEBUDDY_BASE_URL: 'https://api.example.com' }), /已废止服务器级/);
});
