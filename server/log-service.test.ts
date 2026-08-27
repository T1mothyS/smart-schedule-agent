import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-log-service-'));
process.env.DATA_DIR = tempDir;
fs.writeFileSync(path.join(tempDir, 'application.log'), JSON.stringify({
  timestamp: '2026-08-27 20:00:00.000',
  level: 'info',
  category: 'system',
  message: '服务重启前的日志',
}) + '\n', 'utf8');
const logService = await import('./log-service.js');

test('服务重启后会先加载已有持久化日志', () => {
  const result = logService.listLogs({ limit: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.logs[0]?.message, '服务重启前的日志');
});

test('日志会持久化并对邮箱和凭据字段脱敏', () => {
  logService.clearLogs();
  logService.addLog('info', 'reminder', '邮件发送开始至 alice@example.com', {
    event: 'email_send_started',
    recipient: 'alice@example.com',
    password: 'must-not-appear',
    accessToken: 'must-not-appear-either',
    passwordConfigured: true,
    nested: { email: 'bob@example.com' },
  });

  const result = logService.listLogs({ limit: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.logs[0]?.message, '邮件发送开始至 a***@example.com');
  assert.deepEqual(result.logs[0]?.data, {
    event: 'email_send_started',
    recipient: 'a***@example.com',
    password: '[redacted]',
    accessToken: '[redacted]',
    passwordConfigured: true,
    nested: { email: 'b***@example.com' },
  });
  assert.equal(fs.existsSync(path.join(tempDir, 'application.log')), true);
  assert.match(fs.readFileSync(path.join(tempDir, 'application.log'), 'utf8'), /email_send_started/);
});

test('日志清理会同时清理内存和持久化文件', () => {
  logService.clearLogs();
  assert.equal(logService.listLogs().total, 0);
  assert.equal(fs.existsSync(path.join(tempDir, 'application.log')), false);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
