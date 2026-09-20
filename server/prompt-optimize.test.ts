import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizerInput, optimizerOutput, optimizePrompt } from './prompt-optimize.js';
test('optimizer input and result boundaries never silently truncate', () => {
  for (const text of ['', ' ', null, 12, 'a'.repeat(2001)]) assert.throws(() => optimizerInput(text));
  assert.equal(optimizerInput('a'.repeat(2000)).length, 2000);
  assert.equal(optimizerOutput('```text\n任务\n```'), '任务');
  assert.throws(() => optimizerOutput('')); assert.throws(() => optimizerOutput('a'.repeat(2001)));
});
test('optimizer uses isolated SDK options and returns text without executing the request', async () => {
  const run = (({ prompt, options }: any) => {
    assert.equal(prompt, '修复日历'); assert.deepEqual(options.tools, []);
    assert.deepEqual(options.settingSources, []); assert.deepEqual(options.mcpServers, {});
    assert.equal(options.persistSession, false); assert.equal(options.model, 'synthetic');
    return (async function* () { yield { type: 'assistant', message: { content: [{ type: 'text', text: '检查并修复日历问题。' }] } }; })();
  }) as any;
  assert.equal(await optimizePrompt('修复日历', { model: 'synthetic' }, new AbortController(), run), '检查并修复日历问题。');
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(optimizePrompt('修复日历', { model: 'synthetic' }, aborted, run), /取消|超时/);
});
