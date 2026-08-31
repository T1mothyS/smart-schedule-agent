/**
 * Daily Digest V1 的确定性展示层。
 *
 * 上游模型只返回结构化数据；V2 将其序列化为稳定、可读的兼容 Markdown。
 * 本模块只解析该固定格式并用纯函数组件渲染网页与邮件，不解释自由格式内容。
 */

const DIGEST_TITLE = '# Daily Digest';
const DIGEST_MARKER = '<!-- daily-digest.v1 -->';

interface StoryMeta {
  headline: string;
  source: string;
  publishedAt: string;
  url: string;
}

interface LeadStory extends StoryMeta {
  whatHappened: string;
  whyItMatters: string;
  whatToWatch: string;
}

interface DigestItem extends StoryMeta {
  summary: string;
}

interface DigestCategory {
  name: string;
  items: DigestItem[];
}

interface WorthLink {
  title: string;
  source: string;
  url: string;
  note: string;
}

export interface DailyDigest {
  schemaVersion: 'daily-digest.v1';
  date: string;
  theme: string;
  atAGlance: string[];
  leadStories: LeadStory[];
  categories: DigestCategory[];
  worthYourTime: WorthLink[];
}

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

function safeUrl(value: string, required = false): string | null {
  const normalized = value.trim();
  if (!normalized) return required ? null : '';
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
  const publishedAt = field(body[1], '时间：');
  const rawUrl = field(body[2], '链接：');
  const cleanHeadline = normalizedText(headline, 4, 100);
  const cleanSource = source === null ? null : normalizedText(source, 0, 60, true);
  const cleanPublishedAt = publishedAt === null ? null : normalizedText(publishedAt, 0, 40, true);
  const url = rawUrl === null ? null : safeUrl(rawUrl);
  if (cleanHeadline === null || cleanSource === null || cleanPublishedAt === null || url === null) return null;
  return { headline: cleanHeadline, source: cleanSource, publishedAt: cleanPublishedAt, url };
}

export function isDailyDigestMarkdown(markdown: string): boolean {
  const normalized = markdown.replace(/\r\n?/g, '\n').trimStart();
  return normalized.startsWith(`${DIGEST_TITLE}\n${DIGEST_MARKER}`);
}

export function parseDailyDigestMarkdown(markdown: string): DailyDigest | null {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!isDailyDigestMarkdown(normalized)) return null;
  const lines = normalized.split('\n').map(line => line.trim());
  const date = field(lines[2], '日期：');
  const theme = field(lines[3], '今日主题：');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const cleanTheme = theme === null ? null : normalizedText(theme, 8, 90);
  if (!cleanTheme) return null;

  const glanceLines = section(lines, '## Today at a Glance', '## Lead Story');
  const leadLines = section(lines, '## Lead Story', '## Category Digest');
  const categoryLines = section(lines, '## Category Digest', '## Worth Your Time');
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
      const rawSummary = field(body[3], '摘要：');
      const summary = rawSummary === null ? null : normalizedText(rawSummary, 8, 120);
      if (!meta || !summary) return null;
      items.push({ ...meta, summary });
    }
    if (items.length < 1 || items.length > 6) return null;
    categories.push({ name, items });
  }
  if (categories.length < 1 || categories.length > 6) return null;

  const worthYourTime: WorthLink[] = [];
  for (const block of headingBlocks(worthLines, '### ')) {
    const body = block.body.filter(Boolean);
    const title = normalizedText(block.title, 4, 100);
    const rawSource = field(body[0], '来源：');
    const rawUrl = field(body[1], '链接：');
    const rawNote = field(body[2], '推荐理由：');
    const source = rawSource === null ? null : normalizedText(rawSource, 0, 60, true);
    const url = rawUrl === null ? null : safeUrl(rawUrl, true);
    const note = rawNote === null ? null : normalizedText(rawNote, 4, 90);
    if (!title || source === null || !url || !note) return null;
    worthYourTime.push({ title, source, url, note });
  }
  if (worthYourTime.length > 3) return null;

  return {
    schemaVersion: 'daily-digest.v1',
    date,
    theme: cleanTheme,
    atAGlance,
    leadStories,
    categories,
    worthYourTime,
  };
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(parsed);
}

function renderMeta(source: string, publishedAt: string, url = ''): string {
  const pieces = [source, publishedAt].filter(Boolean).map(escapeHtml);
  if (url) pieces.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#0d5c4b;font-weight:750;text-decoration:underline;text-underline-offset:2px">查看来源</a>`);
  return pieces.length ? pieces.join(' · ') : '来源与时间待核验';
}

function Header(digest: DailyDigest): string {
  return `<header class="daily-newsletter-header" style="padding:34px 0 30px;border-bottom:1px solid #d8d5ce">` +
    `<div style="color:#0d5c4b;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Daily Digest · ${escapeHtml(formatDateLabel(digest.date))}</div>` +
    `<h1 style="margin:10px 0 0;color:#171916;font-family:Georgia,'Songti SC','SimSun',serif;font-size:42px;font-weight:700;line-height:1.05;letter-spacing:-.035em">Daily Digest</h1>` +
    `<div style="max-width:560px;margin-top:15px;color:#3d423c;font-family:Georgia,'Songti SC','SimSun',serif;font-size:20px;line-height:1.55">${escapeHtml(digest.theme)}</div>` +
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
    `<span style="color:#252824;font-size:16px;font-weight:650;line-height:1.55">${escapeHtml(item)}</span></li>`,
  ).join('');
  return Section('Today at a Glance', '今日速览', 'at-a-glance', `<ol style="margin:0;padding:0;list-style:none">${items}</ol>`, false);
}

function LeadStoryComponent(story: LeadStory, index: number): string {
  const fields: Array<[string, string, string]> = [
    ['What happened', '发生了什么', story.whatHappened],
    ['Why it matters', '为什么重要', story.whyItMatters],
    ['What to watch', '接下来关注什么', story.whatToWatch],
  ];
  const body = fields.map(([english, chinese, value]) =>
    `<div style="margin-top:21px"><div style="margin-bottom:4px;color:#0d5c4b;font-size:11px;font-weight:850;letter-spacing:.09em;text-transform:uppercase">${english} / ${chinese}</div>` +
    `<p style="margin:0;color:#333731;font-size:16px;line-height:1.72">${escapeHtml(value)}</p></div>`,
  ).join('');
  return `<article style="padding:${index === 1 ? '6px' : '32px'} 0 38px;${index > 1 ? 'border-top:1px solid #d8d5ce;' : ''}">` +
    `<div style="color:#0d5c4b;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Lead ${String(index).padStart(2, '0')}</div>` +
    `<h3 style="margin:8px 0;color:#171916;font-family:Georgia,'Songti SC','SimSun',serif;font-size:29px;line-height:1.28;letter-spacing:-.022em">${escapeHtml(story.headline)}</h3>` +
    `<div style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em">${renderMeta(story.source, story.publishedAt, story.url)}</div>${body}</article>`;
}

function DigestItemComponent(item: DigestItem): string {
  const headline = item.url
    ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none">${escapeHtml(item.headline)}</a>`
    : escapeHtml(item.headline);
  return `<article style="padding:18px 0 19px;border-top:1px solid #e4e1db">` +
    `<h4 style="margin:0 0 5px;color:#20231f;font-family:Georgia,'Songti SC','SimSun',serif;font-size:18px;line-height:1.42">${headline}</h4>` +
    `<div style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em">${renderMeta(item.source, item.publishedAt)}</div>` +
    `<p style="margin:8px 0 0;color:#4b5049;font-size:14.5px;line-height:1.66">${escapeHtml(item.summary)}</p></article>`;
}

function CategoryDigest(digest: DailyDigest): string {
  const categories = digest.categories.map((category, index) =>
    `<div style="padding:${index ? '30px' : '0'} 0 30px;${index ? 'border-top:1px solid #d8d5ce;' : ''}">` +
    `<h3 style="margin:0 0 6px;color:#1d201c;font-family:Georgia,'Songti SC','SimSun',serif;font-size:22px;line-height:1.35">${escapeHtml(category.name)}</h3>` +
    `${category.items.map(DigestItemComponent).join('')}</div>`,
  ).join('');
  return Section('Category Digest', '分类简报', 'category-digest', categories);
}

function WorthYourTime(digest: DailyDigest): string {
  const body = digest.worthYourTime.length
    ? `<ul style="margin:0;padding:0;list-style:none">${digest.worthYourTime.map(item =>
      `<li style="padding:15px 0;border-top:1px solid #e4e1db">` +
      `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color:#20231f;font-family:Georgia,'Songti SC','SimSun',serif;font-size:17px;font-weight:700;line-height:1.4;text-decoration:underline;text-decoration-color:#87a79e;text-underline-offset:3px">${escapeHtml(item.title)}</a>` +
      `<div style="color:#777b74;font-size:11px;font-weight:650;line-height:1.55;letter-spacing:.035em">${escapeHtml(item.source || '延伸阅读')}</div>` +
      `<div style="margin-top:5px;color:#626760;font-size:13px;line-height:1.55">${escapeHtml(item.note)}</div></li>`,
    ).join('')}</ul>`
    : '<p style="margin:0;color:#626760;font-size:13px;line-height:1.55">今天没有额外延伸阅读。</p>';
  return Section('Worth Your Time', '值得花时间', 'worth-your-time', body);
}

function Footer(detailUrl = ''): string {
  const link = detailUrl && safeUrl(detailUrl)
    ? `<div><a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0d5c4b;font-weight:750">在 AI Calendar 中查看私有日报</a></div>`
    : '';
  return `<footer style="margin-top:38px;padding:25px 0 34px;border-top:1px solid #bfc0ba;color:#777b74;font-size:11px;line-height:1.7">` +
    `${link}<div>由日报 V2 自动整理 · 数据仅供参考 · 参考时区 Asia/Shanghai</div></footer>`;
}

export function renderDailyDigest(digest: DailyDigest, detailUrl = ''): string {
  return `<main class="daily-newsletter" style="width:100%;max-width:680px;margin:0 auto;border-top:5px solid #0d5c4b;background:#fff;color:#20221f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif">` +
    `<div class="daily-newsletter-inner" style="padding:0 36px">${Header(digest)}${AtAGlance(digest)}` +
    `${Section('Lead Story', '重点新闻', 'lead-story', digest.leadStories.map((story, index) => LeadStoryComponent(story, index + 1)).join(''))}` +
    `${CategoryDigest(digest)}${WorthYourTime(digest)}${Footer(detailUrl)}</div></main>`;
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
    `@media(max-width:520px){.daily-newsletter-inner{padding:0 22px!important}.daily-newsletter-header h1{font-size:35px!important}.daily-newsletter-section{padding-top:31px!important}}` +
    `</style></head><body style="margin:0;padding:0;background:#f3f1ec">` +
    `<div style="padding:24px 10px">${renderDailyDigest(digest, detailUrl)}</div></body></html>`;
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
  lines.push('Worth Your Time');
  lines.push(...digest.worthYourTime.map(item => `- ${item.title} · ${item.url}`));
  if (detailUrl) lines.push('', `在 AI Calendar 中查看私有日报：${detailUrl}`);
  return lines.join('\n').trim();
}
