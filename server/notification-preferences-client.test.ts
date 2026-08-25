import assert from 'node:assert/strict';
import test from 'node:test';
import { saveNotificationPreferences } from '../src/services/notification-preferences.js';

test('选择常驻地点会立即提交完整地点数据', async () => {
  const homeLocation = {
    name: '深圳',
    admin1: '广东',
    country: '中国',
    latitude: 22.5431,
    longitude: 114.0579,
    timezone: 'Asia/Shanghai',
  };
  let capturedInput = '';
  let capturedInit: RequestInit | undefined;

  await saveNotificationPreferences(
    { enabled: true, homeLocation },
    { Authorization: 'Bearer test-token' },
    async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(JSON.stringify({ preference: { homeLocation } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );

  assert.equal(capturedInput, '/api/notification-preferences');
  assert.equal(capturedInit?.method, 'PUT');
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(String(capturedInit?.body)).homeLocation, homeLocation);
});

test('通知设置接口失败时不会被当作保存成功', async () => {
  await assert.rejects(
    saveNotificationPreferences(
      { homeLocation: null },
      {},
      async () => new Response(JSON.stringify({ error: '地点保存失败' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
    /地点保存失败/,
  );
});
