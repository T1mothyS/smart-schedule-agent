import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveAndReloadNotificationPreferences,
  saveNotificationPreferences,
} from '../src/services/notification-preferences.js';

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

test('保存通知设置后会重新读取服务端持久化值', async () => {
  const calls: string[] = [];
  const persisted = {
    enabled: true,
    hour: 19,
    minute: 0,
    reminderEmail: 'saved@example.com',
  };
  const result = await saveAndReloadNotificationPreferences(
    { enabled: true, hour: 19, minute: 0, reminderEmail: 'saved@example.com' },
    { Authorization: 'Bearer test-token' },
    async (input, init) => {
      calls.push(`${init.method} ${input}`);
      return init.method === 'PUT'
        ? new Response(JSON.stringify({ success: true, preference: persisted }), { status: 200 })
        : new Response(JSON.stringify({ preference: persisted }), { status: 200 });
    },
  );

  assert.deepEqual(calls, ['PUT /api/notification-preferences', 'GET /api/notification-preferences']);
  assert.deepEqual(result.preference, persisted);
});
