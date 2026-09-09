import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_LINKAGE_GUIDE_VERSION, getAiLinkageGuides } from './ai-linkage-guide.js';

test('AI 联动指南包含稳定版本、全链路接入项和可复制示例', () => {
  const guide = getAiLinkageGuides();
  assert.equal(guide.version, AI_LINKAGE_GUIDE_VERSION);
  assert.deepEqual(
    guide.items.map(item => item.id),
    ['codebuddy', 'open-meteo', 'smtp-163', 'qq-imap', 'daily-report-token', 'knowledge-library-token', 'oss-backup', 'imap-import'],
  );
  assert.ok(guide.rules.some(rule => /真实数据/.test(rule.rule)));
  assert.ok(guide.rules.some(rule => /确认/.test(rule.rule)));
  assert.ok(guide.examples.every(example => example.prompt && example.expected));
  const serialized = JSON.stringify(guide);
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|SMTP_PASS\s*=\s*[^<\s]/i);
});
