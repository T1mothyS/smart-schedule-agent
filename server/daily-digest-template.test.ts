import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDailyDigestMarkdown,
  renderDailyDigestEmailPage,
  renderDailyDigestMarkdown,
  renderDailyDigestPlainText,
} from './daily-digest-template.js';

const hostedLeadImage = `/daily-report-media/${'a'.repeat(64)}.jpg`;
const hostedMarketImage = `/daily-report-media/${'b'.repeat(64)}.webp`;

function digestMarkdown(overrides = ''): string {
  return [
    '# Daily Digest',
    '<!-- daily-digest.v1 -->',
    '日期：2026-08-31',
    '今日主题：贸易摩擦与 AI 供应连续性同时进入决策视野',
    '',
    '## Today at a Glance',
    '1. 贸易摩擦正在传导到订单、成本与现金流；指数上涨 1.24%。',
    '2. AI 采购开始同时考察能力、合同关系与供应连续性。',
    '3. 区域市场继续分化，单一指数不足以代表整体风险偏好。',
    '',
    '## Lead Story',
    '### 贸易摩擦开始进入企业经营数据',
    '来源：BBC',
    '时间：2026-08-31 08:05',
    '链接：https://example.com/trade',
    `图片：${hostedLeadImage}`,
    '#### What happened / 发生了什么',
    '内容：公开资料显示，边境企业活动已经受到贸易摩擦影响，但仍缺少完整行业暴露与谈判细节。',
    '#### Why it matters / 为什么重要',
    '内容：成本、订单和回款会先于宏观统计变化，对信用判断比单纯观察市场情绪更直接。',
    '#### What to watch / 接下来关注什么',
    '内容：继续核对出口占比、订单来源、成本转嫁能力、账期和回款。',
    '',
    '## Category Digest',
    '### 市场与观察',
    '#### 区域市场继续分化',
    '来源：Yahoo Finance chart',
    '时间：2026-08-31 收盘',
    '链接：—',
    `图片：${hostedMarketImage}`,
    `摘要：${overrides || '美股科技偏强、A 股走高、韩国市场回落；收益率下跌 0.86%，不同时点数据不能拼成单一风险偏好快照。'}`,
    '',
    '## Mail Tasks',
    '### 确认合同附件',
    '来源：未读邮件',
    '截止：今天 18:00',
    '详情：邮件要求回复并确认附件内容。',
    '',
    '## Worth Your Time',
    '### 贸易摩擦对边境企业的影响',
    '来源：BBC',
    '链接：https://example.com/trade',
    '推荐理由：用于继续核对成本、订单和现金流的传导路径。',
    '',
    '## Footer',
    '由日报 V2 自动整理；数据仅供参考。',
  ].join('\n');
}

test('Daily Digest V1 解析为固定编辑结构', () => {
  const digest = parseDailyDigestMarkdown(digestMarkdown());
  assert.ok(digest);
  assert.equal(digest.atAGlance.length, 3);
  assert.equal(digest.leadStories.length, 1);
  assert.equal(digest.categories[0].items.length, 1);
  assert.equal(digest.mailTasks.length, 1);
  assert.equal(digest.leadStories[0].imageUrl, hostedLeadImage);
  assert.equal(digest.worthYourTime.length, 1);
});

test('Newsletter 渲染使用排版层级而不是卡片集合', () => {
  const html = renderDailyDigestMarkdown(digestMarkdown());
  assert.ok(html);
  assert.match(html, /daily-newsletter/);
  assert.match(html, /Today at a Glance/);
  assert.match(html, /What happened \/ 发生了什么/);
  assert.match(html, /Category Digest/);
  assert.match(html, /邮件待办/);
  assert.match(html, /source-mark/);
  assert.match(html, /market-movement up/);
  assert.match(html, /market-movement down/);
  assert.match(html, /external-link/);
  assert.match(html, /story-image/);
  assert.match(html, /src="\/daily-report-media\/[a-f0-9]{64}\.(?:jpg|webp)"/);
  assert.doesNotMatch(html, /<img[^>]+https?:\/\//i);
  assert.doesNotMatch(html, /source-logo|favicon\.ico/i);
  assert.doesNotMatch(html, /media-strip|source-link|查看来源/);
  assert.doesNotMatch(html, /daily-report-card-grid|linear-gradient|box-shadow/);
  assert.ok(html.indexOf('今日速览') < html.indexOf('重点新闻'));
});

test('Newsletter 不会把未本地化的外站图片输出到 HTML', () => {
  const html = renderDailyDigestMarkdown(digestMarkdown().replace(hostedLeadImage, 'https://images.example/trade.jpg')) || '';
  assert.doesNotMatch(html, /images\.example\/trade\.jpg/);
  assert.match(html, /src="\/daily-report-media\/[a-f0-9]{64}\.webp"/);
});

test('Newsletter 转义正文并拒绝危险链接', () => {
  const html = renderDailyDigestMarkdown(digestMarkdown('<script>alert(1)</script> 仍只作为文本显示。'));
  assert.ok(html);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);

  const unsafe = digestMarkdown().replace('https://example.com/trade', 'javascript:alert(1)');
  assert.equal(parseDailyDigestMarkdown(unsafe), null);
});

test('邮件页面和纯文本均由同一结构化内容生成', () => {
  const email = renderDailyDigestEmailPage(digestMarkdown(), 'https://example.com/reports/2026-08-31');
  const text = renderDailyDigestPlainText(digestMarkdown(), 'https://example.com/reports/2026-08-31');
  assert.ok(email);
  assert.ok(text);
  assert.match(email, /max-width:680px/);
  assert.match(email, /在 AI Calendar 中查看私有日报/);
  assert.match(email, /src="[^"]*\/daily-report-media\/[a-f0-9]{64}\.(?:jpg|webp)"/);
  assert.doesNotMatch(email, /example\.com\/trade\.jpg|favicon\.ico/i);
  assert.match(text, /Today at a Glance/);
  assert.match(text, /Mail Tasks/);
  assert.doesNotMatch(text, /daily-digest\.v1|<!--/);
});
