import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
const require = createRequire(import.meta.url);

test('patched mail stack preserves Chinese, recipients and attachments without SMTP', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix', disableFileAccess: true, disableUrlAccess: true });
  const result = await transport.sendMail({ from: 'Sender <sender@example.invalid>', to: ['one@example.invalid', 'two@example.invalid'], subject: '日历提醒：下午开会', text: '明天 14:00 拿快递', html: '<p>明天 <strong>14:00</strong> 拿快递</p>', attachments: [{ filename: '说明.txt', content: Buffer.from('合成附件') }] });
  const parsed = await simpleParser(result.message);
  assert.equal(parsed.subject, '日历提醒：下午开会');
  assert.match(parsed.text || '', /14:00/);
  assert.equal(Array.isArray(parsed.to) ? parsed.to[0].value.length : parsed.to?.value.length, 2);
  assert.equal(parsed.attachments[0].filename, '说明.txt');
  assert.equal(parsed.attachments[0].content.toString(), '合成附件');
  await assert.rejects(transport.sendMail({ from: 'a@example.invalid', to: 'b@example.invalid', attachments: [{ path: 'https://example.invalid/private' }] }), /access rejected/i);
  await assert.rejects(transport.sendMail({ from: 'a@example.invalid', to: 'b@example.invalid', attachments: [{ path: 'synthetic-private-file' }] }), /access rejected/i);
});

test('patched query and config dependencies preserve normal input and reject unsafe cases', async () => {
  const qs = require('qs');
  assert.deepEqual(qs.parse('filters[status]=pending&page=2'), { filters: { status: 'pending' }, page: '2' });
  const malicious = qs.parse('__proto__[polluted]=true&constructor[prototype][polluted]=true');
  assert.equal(({} as any).polluted, undefined);
  assert.equal(Object.hasOwn(malicious, '__proto__'), false);
  const yaml = require('js-yaml');
  assert.deepEqual(yaml.load('build:\n  target: portable\n  enabled: true'), { build: { target: 'portable', enabled: true } });
  assert.throws(() => yaml.load('x: !!js/function function() {}'), /unknown tag/);
  const joi = require('joi');
  assert.equal(joi.object({ port: joi.number().integer().min(1).max(65535) }).validate({ port: 5173 }).error, undefined);
  assert.ok(joi.number().validate('invalid').error);
  const lodash = await import('lodash-es');
  assert.equal(lodash.template('Hello <%= name %>')({ name: 'calendar' }), 'Hello calendar');
  assert.throws(() => lodash.template('test', { imports: { 'bad=value': 1 } }), /Invalid.*imports/);
});
