import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelService, type ModelSession } from './model-service.js';

interface TestModel {
  modelId: string;
}

function fakeSession(
  models: TestModel[] | Promise<TestModel[]>,
  onClose: () => void,
): ModelSession<TestModel> {
  return {
    getAvailableModels: () => Promise.resolve(models),
    close: onClose,
  };
}

test('模型列表成功后关闭 SDK Session，并在有效期内复用缓存', async () => {
  let created = 0;
  let closed = 0;
  const service = createModelService<TestModel>({ ttlMs: 60_000 });
  const request = {
    userId: 'user-a',
    credentialVersion: 'v1',
    createSession: () => {
      created += 1;
      return fakeSession([{ modelId: 'glm-5.1' }], () => { closed += 1; });
    },
  };

  assert.deepEqual(await service.load(request), [{ modelId: 'glm-5.1' }]);
  assert.deepEqual(await service.load(request), [{ modelId: 'glm-5.1' }]);
  assert.equal(created, 1);
  assert.equal(closed, 1);
});

test('同一用户的并发模型请求合并为一个 SDK Session', async () => {
  let resolveModels!: (models: TestModel[]) => void;
  const deferred = new Promise<TestModel[]>(resolve => { resolveModels = resolve; });
  let created = 0;
  let closed = 0;
  const service = createModelService<TestModel>();
  const request = {
    userId: 'user-a',
    credentialVersion: 'v1',
    createSession: () => {
      created += 1;
      return fakeSession(deferred, () => { closed += 1; });
    },
  };

  const first = service.load(request);
  const second = service.load(request);
  resolveModels([{ modelId: 'glm-5.1' }]);

  assert.deepEqual(await Promise.all([first, second]), [
    [{ modelId: 'glm-5.1' }],
    [{ modelId: 'glm-5.1' }],
  ]);
  assert.equal(created, 1);
  assert.equal(closed, 1);
});

test('模型请求失败或超时时仍关闭 SDK Session，且失败结果不会缓存', async () => {
  let created = 0;
  let closed = 0;
  const service = createModelService<TestModel>({ timeoutMs: 10 });
  const request = {
    userId: 'user-a',
    credentialVersion: 'v1',
    createSession: () => {
      created += 1;
      return fakeSession(new Promise<TestModel[]>(() => {}), () => { closed += 1; });
    },
  };

  await assert.rejects(service.load(request), /获取模型列表超时/);
  await assert.rejects(service.load(request), /获取模型列表超时/);
  assert.equal(created, 2);
  assert.equal(closed, 2);
});

test('强制刷新和凭据更新都会创建新 Session', async () => {
  let created = 0;
  let closed = 0;
  const service = createModelService<TestModel>();
  const createSession = () => {
    created += 1;
    return fakeSession([{ modelId: 'model-' + created }], () => { closed += 1; });
  };

  await service.load({ userId: 'user-a', credentialVersion: 'v1', createSession });
  await service.load({ userId: 'user-a', credentialVersion: 'v1', createSession, forceRefresh: true });
  await service.load({ userId: 'user-a', credentialVersion: 'v2', createSession });

  assert.equal(created, 3);
  assert.equal(closed, 3);
});
