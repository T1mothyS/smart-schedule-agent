/**
 * Daily Digest V1 的确定性展示层。
 *
 * 上游模型只返回结构化数据；V2 将其序列化为稳定、可读的兼容 Markdown。
 * 本模块只解析该固定格式并用纯函数组件渲染网页与邮件，不解释自由格式内容。
 */

import { dailyReportMediaPath, getDailyReportMediaPublicOrigin } from './daily-report-media-service.js';

const DIGEST_TITLE = '# Daily Digest';
const DIGEST_MARKER = '<!-- daily-digest.v1 -->';

interface StoryMeta {
  headline: string;
  source: string;
  sourceLogoUrl: string;
  publishedAt: string;
  url: string;
  imageUrl: string;
}

interface LeadStory extends StoryMeta {
  whatHappened: string;
  whyItMatters: string;
  whatToWatch: string;
}

interface DigestItem extends StoryMeta {
  summary: string;
}

export interface DailyDigestFeaturedStory {
  headline: string;
  source: string;
  sourceLogoUrl: string;
  publishedAt: string;
  url: string;
  imageUrl: string;
  summary: string;
  kind: 'lead' | 'category';
}

interface DigestCategory {
  name: string;
  items: DigestItem[];
}

interface WorthLink {
  title: string;
  source: string;
  sourceLogoUrl: string;
  url: string;
  note: string;
}

interface MailBriefing {
  title: string;
  summary: string;
  whyItMatters: string;
  action: string;
  due: string;
  source: string;
  receivedAt: string;
}

interface MailTask {
  title: string;
  detail: string;
  due: string;
  source: string;
  sourceLogoUrl: string;
}

export interface DailyDigest {
  schemaVersion: 'daily-digest.v1';
  date: string;
  theme: string;
  atAGlance: string[];
  leadStories: LeadStory[];
  categories: DigestCategory[];
  mailBriefings: MailBriefing[];
  mailTasks: MailTask[];
  worthYourTime: WorthLink[];
}

const MARKET_DATA_SOURCES = new Set(['yahoo finance chart', 'yahoo finance']);
const NON_NEWS_CATEGORIES = new Set(['明日安排', '工作与行动', '今日行动']);
export const DAILY_DIGEST_QUALITY_LIMITS = {
  minOrdinaryNews: 5,
  maxOrdinaryNews: 10,
  minSources: 3,
  minCategories: 3,
  minImages: 3,
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizedText(value: string, minimum: number, maximum: number, allowEmpty = false): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (allowEmpty && !normalized) return '';
  if (normalized.length < minimum || normalized.length > maximum) return null;
  return normalized;
}

function safeUrl(value: string, required = false, allowHostedMediaPath = false): string | null {
  const normalized = value.trim();
  if (!normalized) return required ? null : '';
  if (allowHostedMediaPath && dailyReportMediaPath(normalized)) return normalized;
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol.toLowerCase()) ? normalized : null;
  } catch {
    return null;
  }
}

function section(lines: string[], heading: string, nextHeading: string): string[] | null {
  const start = lines.indexOf(heading);
  const end = lines.indexOf(nextHeading, start + 1);
  if (start < 0 || end < 0 || end <= start) return null;
  return lines.slice(start + 1, end);
}

function field(line: string | undefined, label: string): string | null {
  if (!line?.startsWith(label)) return null;
  const value = line.slice(label.length).trim();
  return value === '—' ? '' : value;
}

function headingBlocks(lines: string[], prefix: string): Array<{ title: string; body: string[] }> {
  const blocks: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      if (current) blocks.push(current);
      current = { title: line.slice(prefix.length).trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function storyMeta(headline: string, body: string[]): StoryMeta | null {
  const source = field(body[0], '来源：');
  const hasSourceLogo = body[1]?.startsWith('来源图标：') || false;
  const rawSourceLogoUrl = hasSourceLogo ? field(body[1], '来源图标：') : '';
  const metadataOffset = hasSourceLogo ? 1 : 0;
  const publishedAt = field(body[1 + metadataOffset], '时间：');
  const rawUrl = field(body[2 + metadataOffset], '链接：');
  const rawImageUrl = body[3 + metadataOffset]?.startsWith('图片：') ? field(body[3 + metadataOffset], '图片：') : '';
  const cleanHeadline = normalizedText(headline, 4, 100);
  const cleanSource = source === null ? null : normalizedText(source, 0, 60, true);
  const cleanPublishedAt = publishedAt === null ? null : normalizedText(publishedAt, 0, 40, true);
  const sourceLogoUrl = rawSourceLogoUrl === null ? null : rawSourceLogoUrl ? dailyReportMediaPath(rawSourceLogoUrl) || null : '';
  const url = rawUrl === null ? null : safeUrl(rawUrl);
  const imageUrl = rawImageUrl === null ? null : safeUrl(rawImageUrl, false, true);
  if (cleanHeadline === null || cleanSource === null || cleanPublishedAt === null || sourceLogoUrl === null || url === null || imageUrl === null) return null;
  return { headline: cleanHeadline, source: cleanSource, sourceLogoUrl, publishedAt: cleanPublishedAt, url, imageUrl };
}

export function isDailyDigestMarkdown(markdown: string): boolean {
  const normalized = markdown.replace(/\r\n?/g, '\n').trimStart();
  return normalized.startsWith(`${DIGEST_TITLE}\n${DIGEST_MARKER}`);
}

export function parseDailyDigestMarkdown(markdown: string): DailyDigest | null {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!isDailyDigestMarkdown(normalized)) return null;
  const lines = normalized.split('\n').map(line => line.trim());
  const date = field(lines.find(line => line.startsWith('日期：')), '日期：');
  const theme = field(lines.find(line => line.startsWith('今日主题：')), '今日主题：');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const cleanTheme = theme === null ? null : normalizedText(theme, 8, 90);
  if (!cleanTheme) return null;

  const glanceLines = section(lines, '## Today at a Glance', '## Lead Story');
  const leadLines = section(lines, '## Lead Story', '## Category Digest');
  const hasMailBriefingSection = lines.includes('## Mail Briefing');
  const hasMailTasksSection = lines.includes('## Mail Tasks');
  const categoryEndHeading = hasMailBriefingSection
    ? '## Mail Briefing'
    : hasMailTasksSection
      ? '## Mail Tasks'
      : '## Worth Your Time';
  const categoryLines = section(lines, '## Category Digest', categoryEndHeading);
  const worthLines = section(lines, '## Worth Your Time', '## Footer');
  if (!glanceLines || !leadLines || !categoryLines || !worthLines) return null;

  const atAGlance = glanceLines
    .map(line => /^\d+[.)]\s+(.+)$/.exec(line)?.[1] || '')
    .filter(Boolean)
    .map(item => normalizedText(item, 8, 90))
    .filter((item): item is string => item !== null);
  if (atAGlance.length < 3 || atAGlance.length > 5) return null;

  const leadStories: LeadStory[] = [];
  for (const block of headingBlocks(leadLines, '### ')) {
    const body = block.body.filter(Boolean);
    const meta = storyMeta(block.title, body);
    const happenedIndex = body.indexOf('#### What happened / 发生了什么');
    const mattersIndex = body.indexOf('#### Why it matters / 为什么重要');
    const watchIndex = body.indexOf('#### What to watch / 接下来关注什么');
    if (!meta || happenedIndex < 0 || mattersIndex <= happenedIndex || watchIndex <= mattersIndex) return null;
    const rawWhatHappened = field(body[happenedIndex + 1], '内容：');
    const rawWhyItMatters = field(body[mattersIndex + 1], '内容：');
    const rawWhatToWatch = field(body[watchIndex + 1], '内容：');
    const whatHappened = rawWhatHappened === null ? null : normalizedText(rawWhatHappened, 20, 260);
    const whyItMatters = rawWhyItMatters === null ? null : normalizedText(rawWhyItMatters, 20, 260);
    const whatToWatch = rawWhatToWatch === null ? null : normalizedText(rawWhatToWatch, 12, 220);
    if (!whatHappened || !whyItMatters || !whatToWatch) return null;
    leadStories.push({ ...meta, whatHappened, whyItMatters, whatToWatch });
  }
  if (leadStories.length < 1 || leadStories.length > 2) return null;

  const categories: DigestCategory[] = [];
  for (const categoryBlock of headingBlocks(categoryLines, '### ')) {
    const name = normalizedText(categoryBlock.title, 2, 40);
    if (!name) return null;
    const items: DigestItem[] = [];
    for (const itemBlock of headingBlocks(categoryBlock.body, '#### ')) {
      const body = itemBlock.body.filter(Boolean);
      const meta = storyMeta(itemBlock.title, body);
      const rawSummary = field(body.find(line => line.startsWith('摘要：')), '摘要：');
      const summary = rawSummary === null ? null : normalizedText(rawSummary, 8, 120);
      if (!meta || !summary) return null;
      items.push({ ...meta, summary });
    }
    if (items.length < 1 || items.length > 6) return null;
    categories.push({ name, items });
  }
  if (categories.length < 1 || categories.length > 6) return null;

  const mailBriefings: MailBriefing[] = [];
  if (hasMailBriefingSection) {
    const mailEndHeading = hasMailTasksSection ? '## Mail Tasks' : '## Worth Your Time';
    const mailBriefingLines = section(lines, '## Mail Briefing', mailEndHeading);
    if (!mailBriefingLines) return null;
    for (const block of headingBlocks(mailBriefingLines, '### ')) {
      const body = block.body.filter(Boolean);
      const title = normalizedText(block.title, 4, 100);
      const source = field(body[0], '来源：');
      const receivedAt = field(body[1], '时间：');
      const rawSummary = field(body.find(line => line.startsWith('摘要：')), '摘要：');
      const rawWhyItMatters = field(body.find(line => line.startsWith('为什么值得看：')), '为什么值得看：');
      const rawAction = field(body.find(line => line.startsWith('需要采取的措施：')), '需要采取的措施：');
      const rawDue = field(body.find(line => line.startsWith('截止：')), '截止：');
      const cleanSource = source === null ? null : normalizedText(source, 0, 60, true);
      const cleanReceivedAt = receivedAt === null ? null : normalizedText(receivedAt, 0, 60, true);
      const summary = rawSummary === null ? null : normalizedText(rawSummary, 8, 220);
      const whyItMatters = rawWhyItMatters === null ? null : normalizedText(rawWhyItMatters, 8, 180);
      const action = rawAction === null ? null : normalizedText(rawAction, 4, 140);
      const due = rawDue === null ? null : normalizedText(rawDue, 0, 40, true);
      if (!title || cleanSource === null || cleanReceivedAt === null || !summary || !whyItMatters || !action || due === null) return null;
      mailBriefings.push({ title, summary, whyItMatters, action, due, source: cleanSource, receivedAt: cleanReceivedAt });
    }
    if (mailBriefings.length > 20) return null;
  }

  const mailTasks: MailTask[] = [];
  if (hasMailTasksSection) {
    const mailLines = section(lines, '## Mail Tasks', '## Worth Your Time');
    if (!mailLines) return null;
    for (const block of headingBlocks(mailLines, '### ')) {
      const body = block.body.filter(Boolean);
      if (!body.length) continue;
      const source = field(body[0], '来源：');
      const hasSourceLogo = body[1]?.startsWith('来源图标：') || false;
      const rawSourceLogoUrl = hasSourceLogo ? field(body[1], '来源图标：') : '';
      const metadataOffset = hasSourceLogo ? 1 : 0;
      const due = field(body[1 + metadataOffset], '截止：');
      const detail = field(body[2 + metadataOffset], '详情：');
      const title = normalizedText(block.title, 4, 100);
      const cleanSource = source === null ? null : normalizedText(source, 0, 60, true);
      const sourceLogoUrl = rawSourceLogoUrl === null ? null : rawSourceLogoUrl ? dailyReportMediaPath(rawSourceLogoUrl) || null : '';
      const cleanDue = due === null ? null : normalizedText(due, 0, 40, true);
      const cleanDetail = detail === null ? null : normalizedText(detail, 8, 220);
      if (!title || cleanSource === null || sourceLogoUrl === null || cleanDue === null || !cleanDetail) return null;
      mailTasks.push({ title, source: cleanSource, sourceLogoUrl, due: cleanDue, detail: cleanDetail });
    }
    if (mailTasks.length > 20) return null;
  }

  const worthYourTime: WorthLink[] = [];
  for (const block of headingBlocks(worthLines, '### ')) {
    const body = block.body.filter(Boolean);
    const title = normalizedText(block.title, 4, 100);
    const rawSource = field(body[0], '来源：');
    const hasSourceLogo = body[1]?.startsWith('来源图标：') || false;
    const rawSourceLogoUrl = hasSourceLogo ? field(body[1], '来源图标：') : '';
    const metadataOffset = hasSourceLogo ? 1 : 0;
    const rawUrl = field(body[1 + metadataOffset], '链接：');
    const rawNote = field(body[2 + metadataOffset], '推荐理由：');
    const source = rawSource === null ? null : normalizedText(rawSource, 0, 60, true);
    const sourceLogoUrl = rawSourceLogoUrl === null ? null : rawSourceLogoUrl ? dailyReportMediaPath(rawSourceLogoUrl) || null : '';
    const url = rawUrl === null ? null : safeUrl(rawUrl, true);
    const note = rawNote === null ? null : normalizedText(rawNote, 4, 90);
    if (!title || source === null || sourceLogoUrl === null || !url || !note) return null;
    worthYourTime.push({ title, source, sourceLogoUrl, url, note });
  }
  if (worthYourTime.length > 3) return null;

  return {
    schemaVersion: 'daily-digest.v1',
    date,
    theme: cleanTheme,
    atAGlance,
    leadStories,
    categories: categories.filter(category => !['工作与行动', '今日行动'].includes(category.name)),
    mailBriefings,
    mailTasks,
    worthYourTime,
  };
}

function isMarketDataStory(story: StoryMeta): boolean {
  return MARKET_DATA_SOURCES.has(story.source.trim().toLowerCase());
}

type DigestStory = LeadStory | DigestItem;

function ordinaryNewsStories(digest: DailyDigest): { story: DigestStory; category: string | null }[] {
  const stories: { story: DigestStory; category: string | null }[] = [];
  for (const story of digest.leadStories) {
    if (!isMarketDataStory(story)) stories.push({ story, category: null });
  }
  for (const category of digest.categories) {
    if (NON_NEWS_CATEGORIES.has(category.name)) continue;
    for (const story of category.items) {
      if (!isMarketDataStory(story)) stories.push({ story, category: category.name });
    }
  }
  const seen = new Set<string>();
  return stories.filter(({ story }) => {
    const key = story.url.trim() ? `url:${story.url.trim()}` : `text:${story.source.trim()}:${story.headline.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectDailyDigestFeaturedStory(
  digest: DailyDigest,
  options: { requireImage?: boolean } = {},
): DailyDigestFeaturedStory | null {
  const requireImage = options.requireImage !== false;
  const ordinary = ordinaryNewsStories(digest);
  const lead = ordinary.find(({ story, category }) => category === null && Boolean(story.imageUrl.trim()));
  const candidate = lead
    || ordinary.find(({ story }) => Boolean(story.imageUrl.trim()))
    || (requireImage ? null : ordinary[0] || null);
  if (!candidate) return null;
  const story = candidate.story;
  return {
    headline: story.headline,
    source: story.source,
    sourceLogoUrl: story.sourceLogoUrl,
    publishedAt: story.publishedAt,
    url: story.url,
    imageUrl: story.imageUrl,
    summary: 'summary' in story ? story.summary : story.whatHappened,
    kind: candidate.category === null ? 'lead' : 'category',
  };
}

export interface DailyDigestQuality {
  ordinaryNewsCount: number;
  sourceCount: number;
  categoryCount: number;
  imageCount: number;
  featured: DailyDigestFeaturedStory;
}

export function validateDailyDigestQuality(
  digest: DailyDigest,
  options: { requireHostedImages?: boolean; requireReliableImages?: boolean } = {},
): DailyDigestQuality {
  const ordinary = ordinaryNewsStories(digest);
  const limits = DAILY_DIGEST_QUALITY_LIMITS;
  const requireReliableImages = options.requireReliableImages !== false;
  const sourceCount = new Set(ordinary.map(({ story }) => story.source.trim()).filter(Boolean)).size;
  const categoryCount = new Set(ordinary.map(({ category }) => category).filter((value): value is string => Boolean(value))).size;
  const imageStories = ordinary.filter(({ story }) => Boolean(story.imageUrl.trim()));
  const imageCount = new Set(imageStories.map(({ story }) => story.imageUrl.trim())).size;
  if (ordinary.length < limits.minOrdinaryNews || ordinary.length > limits.maxOrdinaryNews) {
    throw new Error(`普通新闻数量必须为 ${limits.minOrdinaryNews}–${limits.maxOrdinaryNews} 条（当前 ${ordinary.length} 条；市场数据不计入）`);
  }
  if (sourceCount < limits.minSources) {
    throw new Error(`普通新闻至少需要 ${limits.minSources} 个不同来源（当前 ${sourceCount} 个）`);
  }
  if (categoryCount < limits.minCategories) {
    throw new Error(`普通新闻至少需要 ${limits.minCategories} 个不同分类/角度（当前 ${categoryCount} 个）`);
  }
  if (requireReliableImages && imageCount < limits.minImages) {
    throw new Error(`普通新闻至少需要 ${limits.minImages} 张可靠图片（当前 ${imageCount} 张）`);
  }
  if (options.requireHostedImages && imageStories.some(({ story }) => !dailyReportMediaPath(story.imageUrl))) {
    throw new Error('普通新闻图片必须全部使用本站已托管媒体地址');
  }
  const featured = selectDailyDigestFeaturedStory(digest, { requireImage: requireReliableImages });
  if (!featured) throw new Error(requireReliableImages ? '日报必须包含带有可靠图片的重点新闻或普通新闻作为头版' : '日报必须包含普通新闻作为头版');
  if (options.requireHostedImages && featured.imageUrl && !dailyReportMediaPath(featured.imageUrl)) {
    throw new Error('头版新闻必须使用本站已托管媒体地址');
  }
  return { ordinaryNewsCount: ordinary.length, sourceCount, categoryCount, imageCount, featured };
}

export function validateDailyDigestMarkdown(
  markdown: string,
  options: { requireHostedImages?: boolean; requireReliableImages?: boolean } = {},
): { digest: DailyDigest; quality: DailyDigestQuality } {
  const digest = parseDailyDigestMarkdown(markdown);
  if (!digest) throw new Error('日报正文无法解析为 daily-digest.v1 结构');
  return { digest, quality: validateDailyDigestQuality(digest, options) };
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(parsed);
}

const SOURCE_MARKS: Record<string, string> = {
  BBC: 'BBC',
  新华社: '新',
  人民网: '人',
  央视新闻: '央',
  光明网: '光',
  参考消息: '参',
  财新: '财',
  新浪新闻: '新',
  网易新闻: '网',
  'Federal Reserve': 'Fed',
  SEC: 'SEC',
  OpenAI: 'AI',
  'Google AI': 'G',
};

const MARKET_MOVEMENT = /(?:(?:上涨|下跌|上升|下降|涨|跌)\s*(?:[+＋↑↗]|[-−－↓↘])?|[+＋↑↗]|[-−－↓↘])\s*(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)\s*%/g;

function marketText(value: string): string {
  const escaped = escapeHtml(value);
  return escaped.replace(MARKET_MOVEMENT, token => {
    const tone = /(?:下跌|下降|跌|[-−－↓↘])/.test(token) ? 'down' : 'up';
    return `<span class="market-movement ${tone}" style="font-weight:800;color:${tone === 'up' ? '#dc2626' : '#15803d'};white-space:nowrap">${token}</span>`;
  });
}

function sourceIdentity(source: string, sourceLogoUrl = '', absoluteMediaUrl = false): string {
  const mark = escapeHtml(SOURCE_MARKS[source] || source.slice(0, 2));
  const logoPath = dailyReportMediaPath(sourceLogoUrl);
  const logoUrl = logoPath && absoluteMediaUrl ? `${getDailyReportMediaPublicOrigin()}${logoPath}` : logoPath;
  const icon = logoUrl
    ? `<span class="source-logo-wrap" aria-hidden="true" style="position:relative;display:inline-grid;width:19px;height:19px;place-items:center;flex:0 0 19px;overflow:hidden;border:1px solid #c6d9d2;border-radius:5px;background:#fff"><span class="source-mark source-logo-fallback" style="position:absolute;inset:0;width:auto;height:auto;flex:0 0 auto;border:0;border-radius:0">${mark}</span><img class="source-logo" src="${escapeHtml(logoUrl)}" alt="" width="19" height="19" style="position:relative;z-index:1;display:block;width:100%;height:100%;object-fit:contain;border-radius:4px;background:#fff"></span>`
    : `<span class="source-mark" aria-hidden="true" style="width:19px;height:19px;display:inline-grid;place-items:center;flex:0 0 19px;border:1px solid #c6d9d2;border-radius:5px;background:#eef6f2;color:#0d5c4b;font-size:8px;font-weight:850;line-height:1">${mark}</span>`;
  return `<span class="source-identity" style="display:inline-flex;align-items:center;gap:5px;vertical-align:middle">${icon}<span>${escapeHtml(source)}</span></span>`;
}

function renderMeta(source: string, publishedAt: string, sourceLogoUrl = '', absoluteMediaUrl = false): string {
  const pieces: string[] = [];
  if (source) {
    pieces.push(sourceIdentity(source, sourceLogoUrl, absoluteMediaUrl));
  }
  if (publishedAt) pieces.push(escapeHtml(publishedAt));
  return pieces.length ? pieces.join(' · ') : '来源与时间待核验';
}

function storyImage(story: StoryMeta, absoluteMediaUrl = false, hero = false): string {
  if (!story.imageUrl) return '';
  const mediaPath = dailyReportMediaPath(story.imageUrl);
  if (!mediaPath) return '';
  const imageUrl = absoluteMediaUrl ? `${getDailyReportMediaPublicOrigin()}${mediaPath}` : mediaPath;
  const className = hero ? 'story-image hero-image' : 'story-image';
  const style = hero
    ? 'display:block;width:100%;max-width:100%;height:auto;margin:20px 0 0;border-radius:12px;object-fit:cover'
    : 'display:block;width:100%;max-width:100%;height:auto;margin:16px 0 2px;border-radius:8px;object-fit:cover';
  return `<img class="${className}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(story.headline)}" width="608" style="${style}">`;
}

function storyHeadline(story: StoryMeta, className: string): string {
  const headline = marketText(story.headline);
  if (!story.url) return headline;
  return `<a class="${className}" href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;text-decoration-color:#9bb7af;text-underline-offset:4px">${headline} <span class="external-link" aria-hidden="true" style="color:#0d5c4b;font-weight:850;white-space:nowrap">↗</span></a>`;
}

function Header(digest: DailyDigest, absoluteMediaUrl = false): string {
  const featured = selectDailyDigestFeaturedStory(digest, { requireImage: false });
  const headline = featured ? storyHeadline(featured, 'hero-link') : 'Daily Digest';
  const meta = featured
    ? `<div class="hero-story-meta story-meta" style="margin-top:11px;color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em;overflow-wrap:anywhere">${renderMeta(featured.source, featured.publishedAt, featured.sourceLogoUrl, absoluteMediaUrl)}</div>`
    : '';
  const image = featured ? storyImage(featured, absoluteMediaUrl, true) : '';
  return `<header class="daily-newsletter-header" style="padding:34px 0 30px;border-bottom:1px solid #d8d5ce">` +
    `<div style="color:#0d5c4b;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Daily Digest · ${escapeHtml(formatDateLabel(digest.date))}</div>` +
    `<h1 style="margin:10px 0 0;color:#171916;font-family:Georgia,'Songti SC','SimSun',serif;font-size:42px;font-weight:700;line-height:1.15;letter-spacing:-.035em;overflow-wrap:anywhere">${headline}</h1>` +
    meta + image +
    `<div style="max-width:560px;margin-top:15px;color:#3d423c;font-family:Georgia,'Songti SC','SimSun',serif;font-size:20px;line-height:1.55;overflow-wrap:anywhere">${marketText(featured?.summary || digest.theme)}</div>` +
    '</header>';
}

function Section(englishTitle: string, chineseTitle: string, id: string, content: string, border = true): string {
  return `<section id="${id}" class="daily-newsletter-section" style="padding:38px 0 2px;${border ? 'border-top:1px solid #d8d5ce;' : ''}">` +
    `<div style="margin-bottom:17px"><div style="color:#0d5c4b;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">${escapeHtml(englishTitle)}</div>` +
    `<h2 style="margin:3px 0 0;color:#1d201c;font-family:Georgia,'Songti SC','SimSun',serif;font-size:25px;line-height:1.25;letter-spacing:-.018em">${escapeHtml(chineseTitle)}</h2></div>` +
    `${content}</section>`;
}

function AtAGlance(digest: DailyDigest): string {
  const items = digest.atAGlance.map((item, index) =>
    `<li style="display:flex;gap:10px;padding:13px 0;border-top:1px solid #e4e1db">` +
    `<span style="width:28px;flex:0 0 28px;padding-top:2px;color:#8a8e86;font-size:11px;font-weight:800;letter-spacing:.08em">${String(index + 1).padStart(2, '0')}</span>` +
    `<span style="color:#252824;font-size:16px;font-weight:650;line-height:1.55;overflow-wrap:anywhere">${marketText(item)}</span></li>`,
  ).join('');
  return Section('Today at a Glance', '今日速览', 'at-a-glance', `<ol style="margin:0;padding:0;list-style:none">${items}</ol>`, false);
}

function LeadStoryComponent(story: LeadStory, index: number, absoluteMediaUrl = false, heroExtracted = false): string {
  const fields: Array<[string, string, string]> = [
    ['What happened', '发生了什么', story.whatHappened],
    ['Why it matters', '为什么重要', story.whyItMatters],
    ['What to watch', '接下来关注什么', story.whatToWatch],
  ];
  const body = fields.map(([english, chinese, value]) =>
    `<div style="margin-top:21px"><div style="margin-bottom:4px;color:#0d5c4b;font-size:11px;font-weight:850;letter-spacing:.09em;text-transform:uppercase">${english} / ${chinese}</div>` +
    `<p style="margin:0;color:#333731;font-size:16px;line-height:1.72;overflow-wrap:anywhere">${marketText(value)}</p></div>`,
  ).join('');
  return `<article class="daily-lead-story" style="padding:${index === 1 ? '6px' : '32px'} 0 38px;${index > 1 ? 'border-top:1px solid #d8d5ce;' : ''}">` +
    (heroExtracted
      ? `<div class="lead-detail-kicker" style="color:#0d5c4b;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Lead ${String(index).padStart(2, '0')} · 详细解读</div>`
      : `<div style="color:#0d5c4b;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Lead ${String(index).padStart(2, '0')}</div>` +
        `<h3 style="margin:8px 0;color:#171916;font-family:Georgia,'Songti SC','SimSun',serif;font-size:29px;line-height:1.28;letter-spacing:-.022em;overflow-wrap:anywhere">${storyHeadline(story, 'lead-link')}</h3>` +
        `<div class="story-meta" style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em;overflow-wrap:anywhere">${renderMeta(story.source, story.publishedAt, story.sourceLogoUrl, absoluteMediaUrl)}</div>${storyImage(story, absoluteMediaUrl)}`) +
    body + '</article>';
}

function DigestItemComponent(item: DigestItem, absoluteMediaUrl = false): string {
  const headline = storyHeadline(item, 'digest-link');
  const image = storyImage(item, absoluteMediaUrl);
  const content = `<div class="digest-item-copy" style="min-width:0"><h4 style="margin:0 0 5px;color:#20231f;font-family:Georgia,'Songti SC','SimSun',serif;font-size:18px;line-height:1.42;overflow-wrap:anywhere">${headline}</h4>` +
    `<div class="story-meta" style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em;overflow-wrap:anywhere">${renderMeta(item.source, item.publishedAt, item.sourceLogoUrl, absoluteMediaUrl)}</div>` +
    `<p style="margin:8px 0 0;color:#4b5049;font-size:14.5px;line-height:1.66;overflow-wrap:anywhere">${marketText(item.summary)}</p></div>`;
  return `<article style="padding:18px 0 19px;border-top:1px solid #e4e1db">` +
    `<div class="digest-item-layout${image ? ' with-image' : ''}" style="min-width:0;display:${image ? 'grid' : 'block'};${image ? 'grid-template-columns:minmax(0,1fr) 116px;gap:16px;align-items:start;' : ''}">${content}${image ? image.replace('class="story-image"', 'class="story-image digest-thumb"').replace('width:100%;', 'width:116px;').replace('height:auto;', 'height:78px;').replace('margin:16px 0 2px;', 'margin:0;') : ''}</div></article>`;
}

function CategoryDigest(digest: DailyDigest, absoluteMediaUrl = false): string {
  const featured = selectDailyDigestFeaturedStory(digest, { requireImage: false });
  const isFeatured = (item: DigestItem): boolean => featured?.kind === 'category'
    && Boolean(featured.url && item.url && featured.url === item.url || !featured.url && !item.url && featured.headline === item.headline && featured.source === item.source);
  const categories = digest.categories.map((category, index) =>
    `<div style="padding:${index ? '30px' : '0'} 0 30px;${index ? 'border-top:1px solid #d8d5ce;' : ''}">` +
    `<h3 style="margin:0 0 6px;color:#1d201c;font-family:Georgia,'Songti SC','SimSun',serif;font-size:22px;line-height:1.35">${escapeHtml(category.name)}</h3>` +
    `${category.items.filter(item => !isFeatured(item)).map(item => DigestItemComponent(item, absoluteMediaUrl)).join('')}</div>`,
  ).join('');
  return Section('Category Digest', '分类简报', 'category-digest', categories);
}

function WorthYourTime(digest: DailyDigest, absoluteMediaUrl = false): string {
  const body = digest.worthYourTime.length
    ? `<ul style="margin:0;padding:0;list-style:none">${digest.worthYourTime.map(item =>
      `<li style="padding:15px 0;border-top:1px solid #e4e1db">` +
      `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color:#20231f;font-family:Georgia,'Songti SC','SimSun',serif;font-size:17px;font-weight:700;line-height:1.4;text-decoration:underline;text-decoration-color:#87a79e;text-underline-offset:3px;overflow-wrap:anywhere">${marketText(item.title)} <span class="external-link" aria-hidden="true" style="color:#0d5c4b;font-weight:850">↗</span></a>` +
      `<div class="story-meta" style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em">${renderMeta(item.source || '延伸阅读', '', item.sourceLogoUrl, absoluteMediaUrl)}</div>` +
      `<div style="margin-top:5px;color:#626760;font-size:13px;line-height:1.55;overflow-wrap:anywhere">${marketText(item.note)}</div></li>`,
    ).join('')}</ul>`
    : '<p style="margin:0;color:#626760;font-size:13px;line-height:1.55">今天没有额外延伸阅读。</p>';
  return Section('Worth Your Time', '值得花时间', 'worth-your-time', body);
}

function MailBriefings(digest: DailyDigest, absoluteMediaUrl = false): string {
  const body = digest.mailBriefings.length
    ? digest.mailBriefings.map(briefing => {
      const fields = [
        ['摘要', briefing.summary],
        ['为什么值得看', briefing.whyItMatters],
        ['需要采取的措施', briefing.action],
        ...(briefing.due ? [['截止', briefing.due]] : []),
      ];
      const fieldHtml = fields.map(([label, value]) =>
        `<p style="margin:8px 0 0;color:#4b5049;font-size:14px;line-height:1.66;overflow-wrap:anywhere"><span style="color:#0d5c4b;font-size:11px;font-weight:850;letter-spacing:.04em">${escapeHtml(label)}：</span>${marketText(value)}</p>`,
      ).join('');
      return `<article class="mail-briefing" style="padding:17px 0 19px;border-top:1px solid #e4e1db"><h3 style="margin:0 0 5px;color:#20231f;font-family:Georgia,'Songti SC','SimSun',serif;font-size:18px;line-height:1.42;overflow-wrap:anywhere">${marketText(briefing.title)}</h3><div class="story-meta" style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em;overflow-wrap:anywhere">${renderMeta(briefing.source || '未读邮件', briefing.receivedAt, '', absoluteMediaUrl)}</div>${fieldHtml}</article>`;
    }).join('')
    : '<p class="mail-briefing-empty" style="margin:0;color:#626760;font-size:13px;line-height:1.55">今天没有需要简报的未读邮件。</p>';
  return Section('Mail Briefing', '邮件简报', 'mail-briefing', body);
}

function MailTasks(digest: DailyDigest, absoluteMediaUrl = false): string {
  const body = digest.mailTasks.length
    ? digest.mailTasks.map(task => `<article class="mail-task" style="padding:17px 0 19px;border-top:1px solid #e4e1db"><h3 style="margin:0 0 5px;color:#20231f;font-family:Georgia,'Songti SC','SimSun',serif;font-size:18px;line-height:1.42;overflow-wrap:anywhere">${marketText(task.title)}</h3><div class="story-meta" style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em">${renderMeta(task.source || '未读邮件', task.due, task.sourceLogoUrl, absoluteMediaUrl)}</div><p style="margin:8px 0 0;color:#4b5049;font-size:14px;line-height:1.66;overflow-wrap:anywhere">${marketText(task.detail)}</p></article>`).join('')
    : '<p class="mail-task-empty" style="margin:0;color:#626760;font-size:13px;line-height:1.55">邮件简报中没有识别到明确需要执行的动作。</p>';
  return Section('Mail Tasks', '邮件待办', 'mail-tasks', body);
}

function Footer(detailUrl = ''): string {
  const link = detailUrl && safeUrl(detailUrl)
    ? `<div><a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0d5c4b;font-weight:750">在 AI Calendar 中查看私有日报</a></div>`
    : '';
  return `<footer style="margin-top:38px;padding:25px 0 34px;border-top:1px solid #bfc0ba;color:#777b74;font-size:11px;line-height:1.7">` +
    `${link}<div>由日报 V2 自动整理 · 数据仅供参考 · 参考时区 Asia/Shanghai</div></footer>`;
}

export function renderDailyDigest(digest: DailyDigest, detailUrl = '', options: { absoluteMediaUrls?: boolean } = {}): string {
  const absoluteMediaUrls = options.absoluteMediaUrls === true;
  const featured = selectDailyDigestFeaturedStory(digest, { requireImage: false });
  return `<main class="daily-newsletter" style="width:100%;max-width:680px;margin:0 auto;border-top:5px solid #0d5c4b;background:#fff;color:#20221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif">` +
    `<div class="daily-newsletter-inner" style="padding:0 36px">${Header(digest, absoluteMediaUrls)}${AtAGlance(digest)}` +
    `${Section('Lead Story', '重点新闻', 'lead-story', digest.leadStories.map((story, index) => LeadStoryComponent(story, index + 1, absoluteMediaUrls, featured?.kind === 'lead' && featured.headline === story.headline && featured.source === story.source)).join(''))}` +
    `${CategoryDigest(digest, absoluteMediaUrls)}${MailBriefings(digest, absoluteMediaUrls)}${MailTasks(digest, absoluteMediaUrls)}${WorthYourTime(digest, absoluteMediaUrls)}${Footer(detailUrl)}</div></main>`;
}

export function renderDailyDigestMarkdown(markdown: string): string | null {
  const digest = parseDailyDigestMarkdown(markdown);
  return digest ? renderDailyDigest(digest) : null;
}

export function renderDailyDigestEmailPage(markdown: string, detailUrl: string): string | null {
  const digest = parseDailyDigestMarkdown(markdown);
  if (!digest) return null;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(`Daily Digest · ${digest.date}`)}</title><style>` +
    `.daily-newsletter{width:100%;max-width:680px}.daily-newsletter-inner{min-width:0}.source-identity{display:inline-flex;align-items:center;gap:5px;vertical-align:middle}.story-image{display:block;width:100%;max-width:100%;height:auto}.digest-item-layout.with-image{display:grid;grid-template-columns:minmax(0,1fr) 116px;gap:16px;align-items:start}.digest-thumb{width:116px!important;height:78px!important;margin:0!important;object-fit:cover}.market-movement{font-weight:800;white-space:nowrap}@media(max-width:520px){.daily-newsletter-inner{padding:0 22px!important}.daily-newsletter-header h1{font-size:35px!important}.daily-newsletter-section{padding-top:31px!important}.story-meta{display:flex;flex-wrap:wrap;align-items:center;gap:3px 7px;letter-spacing:.01em}.digest-item-layout.with-image{grid-template-columns:minmax(0,1fr) 94px;gap:10px}.digest-thumb{width:94px!important;height:68px!important}}` +
    `</style></head><body style="margin:0;padding:0;background:#f3f1ec">` +
    `<div style="padding:24px 10px">${renderDailyDigest(digest, detailUrl, { absoluteMediaUrls: true })}</div></body></html>`;
}

export function renderDailyDigestPlainText(markdown: string, detailUrl = ''): string | null {
  const digest = parseDailyDigestMarkdown(markdown);
  if (!digest) return null;
  const lines = [
    `Daily Digest · ${digest.date}`,
    digest.theme,
    '',
    'Today at a Glance',
    ...digest.atAGlance.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Lead Story',
  ];
  for (const story of digest.leadStories) {
    lines.push(story.headline, [story.source, story.publishedAt].filter(Boolean).join(' · '));
    lines.push(`发生了什么：${story.whatHappened}`, `为什么重要：${story.whyItMatters}`, `接下来关注：${story.whatToWatch}`, '');
  }
  lines.push('Category Digest');
  for (const category of digest.categories) {
    lines.push(category.name);
    lines.push(...category.items.map(item => `- ${item.headline}：${item.summary}`));
    lines.push('');
  }
  lines.push('Mail Briefing');
  if (digest.mailBriefings.length) {
    for (const briefing of digest.mailBriefings) {
      lines.push(
        briefing.title,
        [briefing.source, briefing.receivedAt].filter(Boolean).join(' · '),
        `摘要：${briefing.summary}`,
        `为什么值得看：${briefing.whyItMatters}`,
        `需要采取的措施：${briefing.action}`,
        ...(briefing.due ? [`截止：${briefing.due}`] : []),
        '',
      );
    }
  } else {
    lines.push('今天没有需要简报的未读邮件。');
  }
  lines.push('Mail Tasks');
  if (digest.mailTasks.length) {
    for (const task of digest.mailTasks) {
      lines.push(`- ${task.title}：${task.detail}${task.due ? `（截止：${task.due}）` : ''}`);
    }
  } else {
    lines.push('邮件简报中没有识别到明确需要执行的动作。');
  }
  lines.push('');
  lines.push('Worth Your Time');
  lines.push(...digest.worthYourTime.map(item => `- ${item.title} · ${item.url}`));
  if (detailUrl) lines.push('', `在 AI Calendar 中查看私有日报：${detailUrl}`);
  return lines.join('\n').trim();
}
