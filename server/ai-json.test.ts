import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAiMessageText, parseAiJson, parseAiJsonCandidates } from './ai-json.js';

test('提取 Markdown 代码块中的 AI JSON', () => {
  const parsed = parseAiJson('```json\n{"intent":"query","operations":[]}\n```');
  assert.equal(parsed.value.intent, 'query');
  assert.equal(parsed.repaired, false);
});

test('修复字符串中未转义的双引号', () => {
  const parsed = parseAiJson('{"reply":"参加\"风险管理\"讲座","operations":[]}');
  assert.equal(parsed.value.reply, '参加"风险管理"讲座');
  assert.equal(parsed.repaired, true);
});

test('多个对象时只解析第一个完整对象', () => {
  const parsed = parseAiJson('{"intent":"chat"}\n调试信息 {"ignored":true}');
  assert.equal(parsed.value.intent, 'chat');
});

test('兼容 SDK assistant.content 为空而最终 JSON 位于 result.result', () => {
  const assistantText = extractAiMessageText({
    type: 'assistant',
    message: { content: [] },
  });
  const resultText = extractAiMessageText({
    type: 'result',
    subtype: 'success',
    result: '{"intent":"chat","reply":"已从知识库找到相关内容","operations":[]}',
  });

  assert.equal(assistantText, '');
  const parsed = parseAiJsonCandidates([assistantText, resultText]);
  assert.equal(parsed.value.intent, 'chat');
  assert.equal(parsed.value.reply, '已从知识库找到相关内容');
});

test('兼容 assistant content 直接为字符串和 structured_output', () => {
  assert.equal(
    extractAiMessageText({ type: 'assistant', message: { content: '{"intent":"chat"}' } }),
    '{"intent":"chat"}',
  );
  assert.equal(
    extractAiMessageText({ type: 'result', structured_output: { intent: 'chat', operations: [] } }),
    '{"intent":"chat","operations":[]}',
  );
});
