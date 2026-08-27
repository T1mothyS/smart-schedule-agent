import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-email-service-'));
process.env.DATA_DIR = tempDir;
const { assertEmailSendResult, normalizeEmailSendResult, summarizeEmailSendResult } = await import('./email-service.js');

test('SMTP accepted 结果会保留可审计字段', () => {
  const result = assertEmailSendResult({
    accepted: ['receiver@example.com'],
    rejected: [],
    pending: [],
    response: '250 2.0.0 OK',
    messageId: '<message@example.com>',
    envelope: { from: 'sender@example.com', to: ['receiver@example.com'] },
  });

  assert.deepEqual(summarizeEmailSendResult(result), {
    messageId: '<message@example.com>',
    response: '250 2.0.0 OK',
    acceptedCount: 1,
    rejectedCount: 0,
    pendingCount: 0,
    envelopeToCount: 1,
  });
});

test('SMTP 没有 accepted 或存在 rejected 时必须进入失败路径', () => {
  for (const info of [
    { accepted: [], rejected: ['receiver@example.com'], pending: [] },
    { accepted: ['receiver@example.com'], rejected: ['other@example.com'], pending: [] },
    { accepted: [], rejected: [], pending: ['receiver@example.com'] },
  ]) {
    assert.throws(
      () => assertEmailSendResult(info),
      error => error instanceof Error
        && (error as Error & { code?: string }).code === 'EENVELOPE'
        && (error as Error & { emailResult?: unknown }).emailResult != null,
    );
  }
});

test('Nodemailer 结果缺少可选字段时仍能稳定归一化', () => {
  assert.deepEqual(normalizeEmailSendResult({ accepted: 'receiver@example.com' }), {
    accepted: ['receiver@example.com'],
    rejected: [],
    pending: [],
    response: null,
    messageId: null,
    envelope: null,
  });
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
