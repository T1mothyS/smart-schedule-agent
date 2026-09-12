import assert from 'node:assert/strict';
import test from 'node:test';
import type { DailyDigest } from './daily-digest-template.js';
import {
  assertCloudDigestCompleteness,
  getCloudDigestCompletenessRequirements,
} from './daily-report-cloud-completeness.js';

function digest(overrides: Partial<DailyDigest> = {}): DailyDigest {
  return {
    schemaVersion: 'daily-digest.v1',
    date: '2026-09-12',
    theme: '完整性测试日报',
    atAGlance: ['第一条速览'],
    leadStories: [],
    categories: [],
    mailBriefings: [],
    mailTasks: [],
    worthYourTime: [],
    ...overrides,
  };
}

function category(name: string, stories: Array<{ headline: string; summary: string }>): DailyDigest['categories'][number] {
  return {
    name,
    items: stories.map(story => ({
      headline: story.headline,
      source: 'Test Source',
      sourceLogoUrl: '',
      publishedAt: '2026-09-12',
      url: `https://example.com/${encodeURIComponent(story.headline)}`,
      imageUrl: '',
      summary: story.summary,
    })),
  };
}

const marketCategory = category('金融与市场', [
  { headline: '市场快照', summary: '市场数据按各自时间点记录。' },
]);

const watchlistCategory = category('观察名单', [
    { headline: '腾讯控股观察', summary: '腾讯控股 Thesis 暂无变化。' },
    { headline: 'NVIDIA 观察', summary: 'NVDA Thesis 继续观察。' },
]);

function mailBriefing(title: string): DailyDigest['mailBriefings'][number] {
  return {
    title,
    summary: '测试邮件摘要。',
    whyItMatters: '测试邮件值得查看。',
    action: '暂未发现需要立即执行的动作',
    due: '',
    source: 'Test Mail',
    receivedAt: '2026-09-12',
  };
}

const requirements = getCloudDigestCompletenessRequirements({
  mail: { unreadCount: 2, messages: [{}, {}] },
  cloudContext: {
    watchlist: {
      stocks: [
        { symbol: '0700.HK', name: '腾讯控股' },
        { symbol: 'NVDA', name: 'NVIDIA' },
      ],
    },
  },
});

test('Cloud 完整日报覆盖两封未读邮件、行情和全部关注股票', () => {
  assert.doesNotThrow(() => assertCloudDigestCompleteness(digest({
    categories: [marketCategory, watchlistCategory],
    mailBriefings: [mailBriefing('一'), mailBriefing('二')],
  }), requirements));
});

test('Cloud 有未读邮件但邮件简报不足时拒绝发布', () => {
  assert.throws(
    () => assertCloudDigestCompleteness(digest({ categories: [marketCategory, watchlistCategory] }), requirements),
    /缺少未读邮件简报/,
  );
});

test('Cloud 缺少行情栏目时拒绝发布', () => {
  const noMailRequirements = getCloudDigestCompletenessRequirements({ mail: { messages: [] }, cloudContext: {} });
  assert.throws(
    () => assertCloudDigestCompleteness(digest(), noMailRequirements),
    /金融与市场/,
  );
});

test('Cloud 缺少关注名单或未覆盖股票时拒绝发布', () => {
  const watchlistRequirements = getCloudDigestCompletenessRequirements({
    mail: { messages: [] },
    cloudContext: {
      watchlist: {
        stocks: [
          { symbol: '0700.HK', name: '腾讯控股' },
          { symbol: 'NVDA', name: 'NVIDIA' },
        ],
      },
    },
  });
  assert.throws(
    () => assertCloudDigestCompleteness(digest({ categories: [marketCategory] }), watchlistRequirements),
    /观察名单/,
  );
  assert.throws(
    () => assertCloudDigestCompleteness(digest({
      categories: [marketCategory, category('观察名单', [{ headline: '市场观察', summary: '没有股票名称。' }])],
    }), watchlistRequirements),
    /未覆盖/,
  );
});
