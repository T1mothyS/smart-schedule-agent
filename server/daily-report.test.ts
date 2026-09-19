import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-test-'));
process.env.DATA_DIR = tempDir;
process.env.APP_TIMEZONE = 'Asia/Shanghai';

const db = await import('./db.js');
const activity = await import('./activity-store.js');
const reports = await import('./daily-report-service.js');
const renderer = await import('./markdown-renderer.js');

await db.initDb();
await activity.initActivityDb();

const userId = 'daily-report-user';
const otherUserId = 'daily-report-other-user';
const now = new Date().toISOString();
const hostedPreviewImage = `/daily-report-media/${'d'.repeat(64)}.jpg`;

function structuredPreviewMarkdown(): string {
  return [
    '# Daily Digest',
    '<!-- daily-digest.v1 -->',
    '日期：2026-09-08',
    '今日主题：今天需要关注政策变化与企业经营的真实影响',
    '',
    '## Today at a Glance',
    '1. 政策变化正在传导到订单、成本与现金流。',
    '2. 企业需要同时核对需求、供应和回款变化。',
    '3. 市场反应与经营数据仍然需要分开观察。',
    '',
    '## Lead Story',
    '### 今日重点新闻标题',
    '来源：BBC',
    '时间：2026-09-08 08:05',
    '链接：https://example.com/lead',
    `图片：${hostedPreviewImage}`,
    '#### What happened / 发生了什么',
    '内容：公开资料显示，企业经营活动正在受到新变化影响，但仍需要核对完整行业范围。',
    '#### Why it matters / 为什么重要',
    '内容：订单、成本和回款会先于宏观统计变化，对判断真实影响更加直接。',
    '#### What to watch / 接下来关注什么',
    '内容：继续核对订单来源、成本转嫁能力、账期和回款情况。',
    '',
    '## Category Digest',
    '### 市场与观察',
    '#### 区域市场变化',
    '来源：Yahoo Finance chart',
    '时间：2026-09-08 收盘',
    '链接：https://example.com/market',
    '摘要：市场继续分化，不同时点数据不能拼成单一判断。',
    '',
    '## Mail Briefing',
    '',
    '## Mail Tasks',
    '',
    '## Worth Your Time',
    '',
    '## Footer',
    '由日报 V2 自动整理。',
  ].join('\n');
}
for (const [id, email] of [[userId, 'daily-report@example.com'], [otherUserId, 'other-report@example.com']] as const) {
  db.createUser({
    id,
    email,
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: now,
    updated_at: now,
  });
}
db.upsertReminder({
  id: 'daily-report-reminder',
  user_id: userId,
  enabled: 0,
  hour: 8,
  minute: 0,
  reminder_email: 'daily-report@example.com',
  report_email_enabled: 1,
  created_at: now,
  updated_at: now,
});
db.upsertReminder({
  id: 'daily-report-other-reminder',
  user_id: otherUserId,
  enabled: 0,
  hour: 8,
  minute: 0,
  reminder_email: 'other-report@example.com',
  created_at: now,
  updated_at: now,
});

test('日报 Markdown 会转义 HTML，并拒绝危险链接', () => {
  const html = renderer.renderMarkdown([
    '# 标题 <script>alert(1)</script>',
    '',
    '**重点** [安全来源](https://example.com/source) [危险](javascript:alert(1)) [协议相对地址](//evil.example)',
    '',
    '| 项目 | 状态 |',
    '| --- | --- |',
    '| A | 已完成 |',
  ].join('\n'));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /href="https:\/\/example\.com\/source"/);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /href="\/\/evil\.example"/i);
  assert.match(html, /<table>/);
});

test('日报展示会生成彩色卡片和静态章节跳转', () => {
  const html = renderer.renderMarkdown([
    '# 一、今日值得搞明白的事',
    '',
    '1. **第一条重点。** 这是需要快速扫读的解释，==风险数字==需要特别留意。',
    '',
    '# 二、邮箱与今天要做的事',
    '',
    '| 优先级 | 事项 | 截止 | 要做什么 |',
    '| --- | --- | --- | --- |',
    '| 高 | 核对通知 | 今天 | 查看原邮件 |',
  ].join('\n'));
  assert.match(html, /id="report-toc"/);
  assert.match(html, /href="#section-1"/);
  assert.match(html, /href="#section-2"/);
  assert.match(html, /href="#report-toc"/);
  assert.match(html, /daily-report-brief-card/);
  assert.match(html, /daily-report-data-card/);
  assert.match(html, /background:#fff1f2/);
  assert.match(html, /color:#b42318/);
  assert.doesNotMatch(html, /<script/i);
});

test('日报市场卡片按指数涨跌着色，并为缺失报价的板块显示状态', () => {
  const html = renderer.renderMarkdown([
    '# 三、市场与我的雷达',
    '',
    '| 市场 | 点位 | 涨跌 | 数据时间 |',
    '| --- | --- | --- | --- |',
    '| 指数A | 100 | +1.2% | 今日 |',
    '| 指数B | 90 | -2.0% | 今日 |',
    '',
    '| 板块 | 状态 | 判断 |',
    '| --- | --- | --- |',
    '| AI | 🟡 观察 | 暂无可靠报价，保持观察 |',
  ].join('\n'));
  assert.match(html, /color:#dc2626/);
  assert.match(html, /color:#15803d/);
  assert.match(html, /今日状态 · 🟡 观察/);
  assert.doesNotMatch(html, />—<\/div>/);
});

test('日报隐藏已移除的工具章节，并放大为什么问题标题', () => {
  const html = renderer.renderMarkdown([
    '# 一、今日值得搞明白的事',
    '',
    '保留。',
    '',
    '# 五、值得看的工具 / GitHub',
    '',
    '不应展示。',
    '',
    '# 六、每日一个为什么',
    '',
    '### 金融｜为什么会这样？',
    '',
    '机制。',
    '',
    '# 七、今日行动',
    '',
    '行动。',
  ].join('\n'));
  assert.doesNotMatch(html, /值得看的工具|不应展示/);
  assert.match(html, /daily-report-why-title/);
  assert.match(html, /金融｜为什么会这样/);
  assert.equal((html.match(/id="section-/g) || []).length, 3);
});

test('日报列表派生干净预览、重点标题和已托管头图', () => {
  const view = reports.toDailyReportView({
    id: 'preview-report',
    userId,
    reportDate: '2026-09-08',
    markdown: structuredPreviewMarkdown(),
    contentHash: 'preview-hash',
    publishedAt: now,
    updatedAt: now,
    emailNotificationId: null,
  } as any, false);
  assert.equal(view.headline, '今日重点新闻标题');
  assert.equal(view.heroImageUrl, hostedPreviewImage);
  assert.match(view.excerpt, /^今日主要新闻概览：/);
  assert.doesNotMatch(view.excerpt, /daily-digest\.v1|<!--|##|`/);
});

test('日报列表不会引用未托管的重点图片', () => {
  const view = reports.toDailyReportView({
    id: 'external-preview-report',
    userId,
    reportDate: '2026-09-06',
    markdown: structuredPreviewMarkdown().replace(hostedPreviewImage, 'https://images.example/lead.jpg'),
    contentHash: 'external-preview-hash',
    publishedAt: now,
    updatedAt: now,
    emailNotificationId: null,
  } as any, false);
  assert.equal(view.heroImageUrl, null);
  assert.equal(view.headline, '今日重点新闻标题');
  assert.match(view.excerpt, /^今日主要新闻概览：/);
});

test('旧日报预览跳过结构标记并使用第一段有效正文', () => {
  const view = reports.toDailyReportView({
    id: 'legacy-preview-report',
    userId,
    reportDate: '2026-09-07',
    markdown: [
      '# Daily Digest',
      '<!-- daily-digest.v1 -->',
      '日期：2026-09-07',
      '',
      '## Today at a Glance',
      '',
      '1. **真正的新闻概览**：这是列表预览应显示的第一段正文。',
    ].join('\n'),
    contentHash: 'legacy-preview-hash',
    publishedAt: now,
    updatedAt: now,
    emailNotificationId: null,
  } as any, false);
  assert.equal(view.headline, null);
  assert.equal(view.heroImageUrl, null);
  assert.equal(view.excerpt, '真正的新闻概览：这是列表预览应显示的第一段正文。');
  assert.doesNotMatch(view.excerpt, /Daily Digest|Today at a Glance|<!--|\*\*/);
});

test('日报发布按账号和内容版本幂等，更新正文会重新发信', async () => {
  const firstMarkdown = '# 2026-08-30\n\n第一版日报';
  const first = await reports.publishDailyReport(userId, '2026-08-30', firstMarkdown);
  assert.equal(first.reportStatus, 'CREATED');
  assert.equal(first.emailStatus, 'QUEUED');
  const firstNotification = activity.listNotifications(userId)[0];
  assert.ok(firstNotification);
  assert.equal(firstNotification.kind, 'daily_report');
  assert.equal(firstNotification.maxAttempts, 1);
  assert.equal(firstNotification.body, firstMarkdown);

  const unchanged = await reports.publishDailyReport(userId, '2026-08-30', firstMarkdown);
  assert.equal(unchanged.reportStatus, 'UNCHANGED');
  assert.equal(unchanged.emailStatus, 'ALREADY_QUEUED');
  assert.equal(unchanged.report.emailNotificationId, firstNotification.id);
  assert.equal(activity.listNotifications(userId).length, 1);

  const updatedMarkdown = '# 2026-08-30\n\n修订版日报';
  const updated = await reports.publishDailyReport(userId, '2026-08-30', updatedMarkdown);
  assert.equal(updated.reportStatus, 'UPDATED');
  assert.equal(updated.emailStatus, 'QUEUED');
  const updatedNotification = activity.listNotifications(userId)[0];
  assert.ok(updatedNotification);
  assert.notEqual(updatedNotification.id, firstNotification.id);
  assert.equal(updatedNotification.body, updatedMarkdown);
  assert.equal(updated.report.emailNotificationId, updatedNotification.id);
  assert.equal(activity.listNotifications(userId).length, 2);
  assert.equal(reports.getDailyReportView(userId, '2026-08-30')?.markdown, updatedMarkdown);
  assert.equal(reports.getDailyReportView(otherUserId, '2026-08-30'), null);

  const updatedDuplicate = await reports.publishDailyReport(userId, '2026-08-30', updatedMarkdown);
  assert.equal(updatedDuplicate.reportStatus, 'UNCHANGED');
  assert.equal(updatedDuplicate.emailStatus, 'ALREADY_QUEUED');
  assert.equal(activity.listNotifications(userId).length, 2);
});

test('日报发布在入库和邮件快照前完成图片本地化', async () => {
  const integrationUserId = 'daily-report-media-integration-user';
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-daily-report-publish-media-'));
  const nowForMedia = new Date().toISOString();
  db.createUser({
    id: integrationUserId,
    email: 'daily-report-media@example.com',
    password_hash: 'not-a-real-password',
    role: 'user',
    disabled: 0,
    created_at: nowForMedia,
    updated_at: nowForMedia,
  });
  db.upsertReminder({
    id: 'daily-report-media-integration-reminder',
    user_id: integrationUserId,
    enabled: 0,
    hour: 8,
    minute: 0,
    reminder_email: 'daily-report-media@example.com',
    report_email_enabled: 1,
    created_at: nowForMedia,
    updated_at: nowForMedia,
  });
  const sourceUrl = 'https://images.example/publish.png';
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  try {
    const result = await reports.publishDailyReport(
      integrationUserId,
      '2026-09-02',
      `# Daily Digest\n<!-- daily-digest.v1 -->\n图片：${sourceUrl}`,
      {
        mediaRoot,
        publicOrigin: 'https://gotimothy.online',
        lookup: async () => [{ address: '93.184.216.34', family: 4 as const }],
        fetcher: async () => new Response(image, { status: 200, headers: { 'content-type': 'image/png' } }),
      },
    );
    assert.equal(result.reportStatus, 'CREATED');
    assert.equal(result.emailStatus, 'QUEUED');
    const notification = activity.listNotifications(integrationUserId)[0];
    assert.ok(notification);
    assert.match(notification.body, /https:\/\/gotimothy\.online\/daily-report-media\/[a-f0-9]{64}\.png/);
    assert.doesNotMatch(notification.body, /images\.example/);
    const stored = activity.getDailyReport(integrationUserId, '2026-09-02');
    assert.ok(stored);
    assert.match(stored.markdown, /https:\/\/gotimothy\.online\/daily-report-media\/[a-f0-9]{64}\.png/);
    assert.doesNotMatch(stored.markdown, /images\.example/);
  } finally {
    activity.deleteUserActivity(integrationUserId);
    db.deleteUser(integrationUserId);
  }
});

test('日报邮件失败后不自动重试，但允许显式手动重试', () => {
  const notification = activity.listNotifications(userId)[0];
  assert.ok(notification);
  assert.equal(activity.claimNotification(notification.id), true);
  activity.markNotificationFailed(notification.id, 'fake SMTP failure');
  const failed = activity.getNotification(notification.id, userId)!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.nextRetryAt, null);
  assert.equal(activity.listDueNotifications().some(item => item.id === notification.id), false);
  assert.equal(reports.getDailyReportView(userId, '2026-08-30')?.emailStatus, 'FAILED');

  const retried = activity.retryNotification(notification.id, userId);
  assert.equal(retried?.status, 'pending');
  assert.equal(reports.getDailyReportView(userId, '2026-08-30')?.emailStatus, 'QUEUED');
});

test('日报支持在详情中手动重新发送当前正文', () => {
  const manuallyQueued = reports.queueDailyReportEmail(userId, '2026-08-30', { manual: true });
  assert.ok(manuallyQueued);
  assert.equal(manuallyQueued.emailStatus, 'QUEUED');
  assert.equal(manuallyQueued.emailNotificationId, activity.listNotifications(userId)[0].id);
  assert.equal(activity.listNotifications(userId).length, 3);
  assert.equal(activity.listNotifications(userId)[0].body, '# 2026-08-30\n\n修订版日报');
});

test('日报包含在活动导出、删除和恢复链路中', () => {
  const exported = activity.exportUserActivity(userId);
  assert.equal((exported.dailyReports || []).length, 2);
  const deleted = activity.deleteUserActivity(userId);
  assert.equal(deleted.dailyReports, 2);
  assert.equal(activity.listDailyReports(userId).length, 0);
  const restored = activity.restoreUserActivity(userId, exported as Record<string, any[]>, 'merge');
  assert.equal(restored.dailyReports, 2);
  assert.equal(activity.listDailyReports(userId).length, 1);
});

test('media receipts persist per version, warn on image loss, isolate owners, and survive restore', async () => {
  const owner = 'media-receipt-owner';
  const date = '2026-09-20';
  const withImage = structuredPreviewMarkdown().replaceAll('2026-09-08', date);
  const noImage = withImage.replaceAll(`图片：${hostedPreviewImage}`, '图片：');
  activity.createDailyReport({ userId: owner, reportDate: date, source: 'cloud', markdown: withImage, contentHash: reports.hashDailyReport(withImage) });
  activity.createDailyReport({ userId: owner, reportDate: '2026-09-19', source: 'cloud', markdown: '# Previous no image', contentHash: 'previous' });
  const audit = { candidateImageCount: 0, failureCodes: [], noImageReason: 'no_reliable_source' };
  const before = activity.exportActivityDb();
  const preview = reports.previewDailyReportMedia(owner, date, 'cloud', noImage, audit);
  assert.deepEqual(activity.exportActivityDb(), before);
  assert.equal(preview.consecutiveNoImageReports, 2);
  assert.ok(preview.warnings.includes('REPLACES_ILLUSTRATED_REPORT'));
  assert.ok(preview.warnings.includes('REPEATED_NO_IMAGES'));
  assert.equal(reports.previewDailyReportMedia('different-owner', date, 'cloud', noImage, audit).previousImageCount, 0);
  const result = await reports.publishDailyReport(owner, date, noImage, { source: 'cloud', requireHostedMedia: true, mediaAudit: audit });
  assert.deepEqual(result.report.mediaReceipt, preview);
  const replay = await reports.publishDailyReport(owner, date, noImage, { source: 'cloud', requireHostedMedia: true, mediaAudit: audit });
  assert.equal(replay.reportStatus, 'UNCHANGED');
  assert.deepEqual(replay.report.mediaReceipt, preview);
  assert.equal(activity.listAllDailyReports(owner).length, 3);
  const exported = activity.exportUserActivity(owner);
  activity.restoreUserActivity('restored-owner', { dailyReports: (exported.dailyReports as any[]).map(row => ({ ...row, id: 'restored-' + row.id })) }, 'merge');
  assert.deepEqual(activity.getLatestDailyReportCandidate('restored-owner', date, 'cloud')?.mediaReceipt, preview);
  assert.equal(activity.updateDailyReport(result.report.id, owner, noImage + '\n', 'edited')?.mediaReceipt, null);
  assert.throws(() => reports.previewDailyReportMedia(owner, date, 'cloud', noImage, { ...audit, noImageReason: 'arbitrary details' }), /noImageReason/);
});
