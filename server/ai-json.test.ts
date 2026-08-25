import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiJson } from './ai-json.js';

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
