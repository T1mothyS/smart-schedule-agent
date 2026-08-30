/**
 * 个人情报日报的 HTML 展示层。
 *
 * 日报仍以 Markdown 保存；本模块只在网站和邮件展示时把日报 Markdown
 * 转成带静态锚点和卡片样式的安全 HTML。它不执行正文中的原始 HTML。
 */

import { escapeHtml } from './markdown-renderer.js';

type Palette = { background: string; border: string; text: string };

const CARD_PALETTES: Palette[] = [
  { background: '#fff1f2', border: '#e11d48', text: '#9f1239' },
  { background: '#eff6ff', border: '#2563eb', text: '#1d4ed8' },
  { background: '#ecfdf5', border: '#059669', text: '#047857' },
  { background: '#fffbeb', border: '#d97706', text: '#b45309' },
  { background: '#f5f3ff', border: '#7c3aed', text: '#6d28d9' },
  { background: '#ecfeff', border: '#0891b2', text: '#0e7490' },
];

const SECTION_COLORS = ['#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be123c', '#0e7490', '#475569', '#111827'];

const INLINE_TOKEN = /\[([^\]]+)]\(([^)\s]+)\)|`([^`\n]+?)`|==(.+?)==|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<!\*)\*([^*\n]+?)\*(?!\*)/g;

function isSafeLink(value: string): boolean {
  const link = value.trim();
  if (!link || /[\u0000-\u001f\u007f]/.test(link) || link.startsWith('//')) return false;
  if (link.startsWith('/') || link.startsWith('#') || link.startsWith('./') || link.startsWith('../')) return true;
  try {
    const protocol = new URL(link, 'https://invalid.local').protocol.toLowerCase();
    return ['http:', 'https:', 'mailto:'].includes(protocol);
  } catch {
    return false;
  }
}

function renderInline(value: string): string {
  let output = '';
  let cursor = 0;
  for (const match of value.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    output += escapeHtml(value.slice(cursor, index));
    if (match[1] !== undefined) {
      const label = escapeHtml(match[1]);
      const href = match[2];
      if (isSafeLink(href)) {
        const target = href.startsWith('#')
          ? ' target="_self"'
          : ' target="_blank" rel="noopener noreferrer"';
        output += `<a href="${escapeHtml(href)}"${target}>${label}</a>`;
      } else {
        output += `<span class="daily-report-unsafe-link" style="color:#64748b;text-decoration:line-through;">${label}</span>`;
      }
    } else if (match[3] !== undefined) {
      output += `<code>${escapeHtml(match[3])}</code>`;
    } else if (match[4] !== undefined) {
      output += `<strong style="color:#b42318;font-weight:850;">${escapeHtml(match[4])}</strong>`;
    } else if (match[5] !== undefined || match[6] !== undefined) {
      output += `<strong style="color:#0f766e;font-weight:800;">${escapeHtml(match[5] ?? match[6] ?? '')}</strong>`;
    } else {
      output += `<em>${escapeHtml(match[7] ?? '')}</em>`;
    }
    cursor = index + match[0].length;
  }
  return output + escapeHtml(value.slice(cursor));
}

function tableCells(value: string): string[] {
  let line = value.trim();
  if (line.startsWith('|')) line = line.slice(1);
  if (line.endsWith('|') && !line.endsWith('\\|')) line = line.slice(0, -1);
  return line.split('|').map(cell => cell.trim().replace(/\\\|/g, '|'));
}

function isTableSeparator(value: string): boolean {
  const cells = tableCells(value);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function headerIndex(headers: string[], ...names: string[]): number {
  return headers.findIndex(header => names.some(name => header.toLowerCase().includes(name.toLowerCase())));
}

function cell(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index] : '';
}

function isMissingValue(value: string): boolean {
  return !value.trim() || ['—', '-', '暂无', '未填写', '无数据'].includes(value.trim());
}

function movementColor(...values: string[]): string {
  const movement = /([+＋\-−－])\s*(?:\d|[.,])/;
  for (const value of values) {
    const match = movement.exec(value);
    if (match) return match[1] === '+' || match[1] === '＋' ? '#dc2626' : '#15803d';
  }
  return '#152238';
}

function renderBriefingCards(items: string[]): string {
  const cards = items.map((item, index) => {
    const palette = CARD_PALETTES[index % CARD_PALETTES.length];
    const raw = item.trim();
    let title = raw;
    let detail = '';
    if (raw.startsWith('**')) {
      const end = raw.indexOf('**', 2);
      if (end >= 0) {
        title = raw.slice(2, end);
        detail = raw.slice(end + 2).trim();
      }
    }
    if (!detail) {
      const sentence = raw.match(/^(.+?[。！？!?])\s*(.*)$/);
      if (sentence) {
        title = sentence[1];
        detail = sentence[2];
      }
    }
    return `<article class="daily-report-brief-card" style="min-height:88px;padding:13px 14px;background:${palette.background};border:1px solid ${palette.border};border-left:7px solid ${palette.border};border-radius:12px;">` +
      `<div style="color:${palette.text};font-size:17px;font-weight:850;line-height:1.42;">${renderInline(title)}</div>` +
      (detail ? `<div style="margin-top:7px;color:#354258;font-size:14px;line-height:1.62;">${renderInline(detail)}</div>` : '') +
      '</article>';
  });
  return `<div class="daily-report-card-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:12px;margin:12px 0 16px;">${cards.join('')}</div>`;
}

function renderMailCards(headers: string[], rows: string[][]): string {
  const titleIndex = headerIndex(headers, '事项', '来源与主题', '主题', '候选');
  const categoryIndex = headerIndex(headers, '优先级', '分类');
  const deadlineIndex = headerIndex(headers, '截止');
  const actionIndex = headerIndex(headers, '要做什么', '下一动作', '动作', '建议');
  const cards = rows.map((row, rowIndex) => {
    const palette = CARD_PALETTES[rowIndex % CARD_PALETTES.length];
    const category = cell(row, categoryIndex) || '待处理';
    const title = cell(row, titleIndex) || '未命名事项';
    const deadline = cell(row, deadlineIndex);
    const action = cell(row, actionIndex);
    const details = headers.map((header, index) => ({ header, value: cell(row, index), index }))
      .filter(item => item.value && ![titleIndex, categoryIndex, deadlineIndex, actionIndex].includes(item.index))
      .map(item => `<div style="margin-top:8px;color:#526174;font-size:11px;font-weight:850;letter-spacing:.04em;">${renderInline(item.header)}</div><div style="color:#334155;font-size:13px;line-height:1.58;">${renderInline(item.value)}</div>`)
      .join('');
    return `<article class="daily-report-data-card" style="padding:14px 15px;background:${palette.background};border:1px solid ${palette.border};border-left:7px solid ${palette.border};border-radius:12px;">` +
      `<span style="display:inline-block;padding:3px 8px;border-radius:999px;background:${palette.border};color:#fff;font-size:11px;font-weight:850;">${renderInline(category)}</span>` +
      `<div style="margin-top:8px;color:#172033;font-size:16px;font-weight:850;line-height:1.45;">${renderInline(title)}</div>` +
      (deadline ? `<div style="margin-top:6px;color:${palette.text};font-size:13px;font-weight:800;">截止 · ${renderInline(deadline)}</div>` : '') +
      details +
      (action ? `<div style="margin-top:10px;padding:9px 11px;border-radius:8px;background:#fff;color:#24324a;font-size:14px;line-height:1.55;"><strong style="color:${palette.text};">行动</strong> ${renderInline(action)}</div>` : '') +
      '</article>';
  });
  return `<div class="daily-report-card-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:12px;margin:12px 0 16px;">${cards.join('')}</div>`;
}

function renderMarketCards(headers: string[], rows: string[][]): string {
  const titleIndex = headerIndex(headers, '指标', '市场', '板块', '股票', '资产');
  const mainIndex = headerIndex(headers, '最新 / 变动', '点位', '价格 / 涨跌', '数值与变化');
  const changeIndex = headerIndex(headers, '涨跌', '变化');
  const statusIndex = headerIndex(headers, '状态');
  const summaryIndex = headerIndex(headers, '判断', '看点', '结论', '说明');
  const isIndexTable = headers.some(header => header.includes('点位') || header.includes('最新 / 变动'));
  const cards = rows.map((row, rowIndex) => {
    const palette = CARD_PALETTES[rowIndex % CARD_PALETTES.length];
    let mainParts = [cell(row, mainIndex), changeIndex === mainIndex ? '' : cell(row, changeIndex)].filter(value => !isMissingValue(value));
    let fallbackIndex = -1;
    if (mainParts.length === 0) {
      if (!isMissingValue(cell(row, statusIndex))) {
        mainParts = [`今日状态 · ${cell(row, statusIndex)}`];
        fallbackIndex = statusIndex;
      } else if (!isMissingValue(cell(row, summaryIndex))) {
        mainParts = [`今日判断 · ${cell(row, summaryIndex)}`];
        fallbackIndex = summaryIndex;
      } else {
        mainParts = ['今日状态 · 暂无可靠报价'];
      }
    }
    const main = mainParts.join(' · ') || '—';
    const used = [titleIndex, mainIndex, changeIndex, fallbackIndex];
    const details = headers.map((header, index) => ({ header, value: cell(row, index), index }))
      .filter(item => item.value && !used.includes(item.index))
      .map(item => `<div style="margin-top:8px;color:${palette.text};font-size:11px;font-weight:850;letter-spacing:.04em;">${renderInline(item.header)}</div><div style="color:#334155;font-size:13px;line-height:1.58;">${renderInline(item.value)}</div>`)
      .join('');
    const color = isIndexTable ? movementColor(cell(row, changeIndex), cell(row, mainIndex)) : '#152238';
    return `<article class="daily-report-data-card" style="padding:13px 14px;background:${palette.background};border:1px solid ${palette.border};border-top:5px solid ${palette.border};border-radius:12px;">` +
      `<div style="color:${palette.text};font-size:12px;font-weight:850;letter-spacing:.05em;">${renderInline(cell(row, titleIndex) || '市场指标')}</div>` +
      `<div style="margin-top:4px;color:${color};font-size:20px;font-weight:900;line-height:1.35;">${renderInline(main)}</div>` +
      details +
      '</article>';
  });
  return `<div class="daily-report-card-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:12px;margin:12px 0 16px;">${cards.join('')}</div>`;
}

function renderScheduleCards(headers: string[], rows: string[][]): string {
  const timeIndex = headerIndex(headers, '时间', '时段', '开始时间');
  const endIndex = headerIndex(headers, '结束时间');
  const titleIndex = headerIndex(headers, '安排', '日程', '事项');
  const locationIndex = headerIndex(headers, '地点');
  const notesIndex = headerIndex(headers, '备注', '说明');
  const categoryIndex = headerIndex(headers, '分类');
  const cards = rows.map(row => {
    const start = cell(row, timeIndex) || '时间待核实';
    const end = cell(row, endIndex);
    const time = end && end !== start && end !== '未设置' && end !== '—' ? `${start}–${end}` : start;
    const meta = [cell(row, locationIndex), cell(row, categoryIndex)].filter(value => value && value !== '—').join(' · ');
    const notes = cell(row, notesIndex);
    return `<article class="daily-report-data-card" style="padding:13px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-left:6px solid #2563eb;border-radius:12px;">` +
      `<div style="color:#1d4ed8;font-size:12px;font-weight:850;">${renderInline(time)}</div>` +
      `<div style="margin-top:5px;color:#172033;font-size:16px;font-weight:850;line-height:1.45;">${renderInline(cell(row, titleIndex) || '未命名日程')}</div>` +
      (meta ? `<div style="margin-top:6px;color:#64748b;font-size:12px;line-height:1.5;">${renderInline(meta)}</div>` : '') +
      (notes && notes !== '—' ? `<div style="margin-top:9px;padding:8px 10px;border-radius:8px;background:#fff;color:#354258;font-size:13px;line-height:1.55;">${renderInline(notes)}</div>` : '') +
      '</article>';
  });
  return `<div class="daily-report-card-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:12px;margin:12px 0 16px;">${cards.join('')}</div>`;
}

function renderToolCards(headers: string[], rows: string[][]): string {
  const titleIndex = headerIndex(headers, '项目', '工具', '候选');
  const cards = rows.map((row, rowIndex) => {
    const palette = CARD_PALETTES[rowIndex % CARD_PALETTES.length];
    const title = cell(row, titleIndex) || '未命名候选';
    const details = headers.map((header, index) => ({ header, value: cell(row, index), index }))
      .filter(item => item.value && item.index !== titleIndex)
      .map(item => `<div style="margin-top:8px;color:${palette.text};font-size:11px;font-weight:850;letter-spacing:.04em;">${renderInline(item.header)}</div><div style="color:#334155;font-size:13px;line-height:1.58;">${renderInline(item.value)}</div>`)
      .join('');
    return `<article class="daily-report-data-card" style="padding:13px 14px;background:${palette.background};border:1px solid ${palette.border};border-top:5px solid ${palette.border};border-radius:12px;"><div style="color:#172033;font-size:16px;font-weight:850;line-height:1.45;">${renderInline(title)}</div>${details}</article>`;
  });
  return `<div class="daily-report-card-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));gap:12px;margin:12px 0 16px;">${cards.join('')}</div>`;
}

function renderTable(headers: string[], rows: string[][], sectionTitle: string, headingTitle: string): string {
  const context = `${sectionTitle} ${headingTitle}`;
  if (context.includes('邮箱')) return renderMailCards(headers, rows);
  if (context.includes('明日安排')) return renderScheduleCards(headers, rows);
  if (context.includes('市场') || context.includes('雷达')) return renderMarketCards(headers, rows);
  if (context.includes('工具') || context.includes('GitHub')) return renderToolCards(headers, rows);
  const head = headers.map(header => `<th>${renderInline(header)}</th>`).join('');
  const body = rows.map(row => `<tr>${headers.map((_header, index) => `<td>${renderInline(cell(row, index))}</td>`).join('')}</tr>`).join('');
  return `<div class="daily-report-table-wrap" style="width:100%;overflow-x:auto;margin:12px 0 16px;"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderBlocks(lines: string[], sectionTitle = ''): string {
  const blocks: string[] = [];
  let index = 0;
  let currentHeading = sectionTitle;
  let whyTitleRendered = false;

  const renderWhyTitle = (value: string): string => {
    let title = value.trim().replace(/^\*\*(.+?)\*\*$/, '$1');
    if (!/[｜|:：]/.test(title)) title = `综合｜${title}`;
    return `<h3 class="daily-report-why-title" style="margin:19px 0 13px;color:#0f766e;font-size:26px;font-weight:900;line-height:1.3;letter-spacing:-.025em;">${renderInline(title)}</h3>`;
  };

  while (index < lines.length) {
    const value = lines[index].trim();
    if (!value) {
      index += 1;
      continue;
    }
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      currentHeading = heading[2];
      if (sectionTitle.includes('为什么') && !whyTitleRendered && heading[2].includes('为什么') && /[？?]/.test(heading[2])) {
        blocks.push(renderWhyTitle(heading[2]));
        whyTitleRendered = true;
      } else {
        blocks.push(`<h${Math.min(6, Math.max(3, level + 1))}>${renderInline(heading[2])}</h${Math.min(6, Math.max(3, level + 1))}>`);
      }
      index += 1;
      continue;
    }
    if (value.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (index + 1 < lines.length && value.includes('|') && isTableSeparator(lines[index + 1])) {
      const headers = tableCells(value);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(renderTable(headers, rows, sectionTitle, currentHeading));
      continue;
    }
    const orderedMatch = /^\s*\d+[.)]\s+(.+)$/.exec(value);
    const unorderedMatch = /^\s*[-*+]\s+(.+)$/.exec(value);
    if (orderedMatch || unorderedMatch) {
      const ordered = Boolean(orderedMatch);
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index].trim());
        if (!match) break;
        const parts = [match[1].trim()];
        index += 1;
        while (index < lines.length && lines[index].trim() && /^\s/.test(lines[index])) {
          parts.push(lines[index].trim());
          index += 1;
        }
        items.push(parts.join(' '));
        let lookahead = index;
        while (lookahead < lines.length && !lines[lookahead].trim()) lookahead += 1;
        if (lookahead < lines.length && pattern.test(lines[lookahead].trim())) {
          index = lookahead;
          continue;
        }
        break;
      }
      if (ordered && (sectionTitle.includes('值得搞明白') || sectionTitle.includes('今日要点'))) {
        blocks.push(renderBriefingCards(items));
      } else {
        const tag = ordered ? 'ol' : 'ul';
        blocks.push(`<${tag}>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
      }
      continue;
    }
    if (value.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().slice(1).trim());
        index += 1;
      }
      blocks.push(`<blockquote>${quote.filter(Boolean).map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^-{3,}$|^\*{3,}$/.test(value)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }
    const paragraph: string[] = [value];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index].trim();
      if (/^(#{1,6})\s+/.test(next) || next.startsWith('>') || next.startsWith('```')) break;
      if (index + 1 < lines.length && next.includes('|') && isTableSeparator(lines[index + 1])) break;
      if (/^\s*\d+[.)]\s+/.test(next) || /^\s*[-*+]\s+/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    const paragraphText = paragraph.join(' ').trim();
    if (sectionTitle.includes('为什么') && !whyTitleRendered && /为什么.*[？?]$/.test(paragraphText)) {
      blocks.push(renderWhyTitle(paragraphText));
      whyTitleRendered = true;
    } else {
      blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    }
  }
  return blocks.join('\n');
}

function isReportSectionTitle(value: string): boolean {
  return /^(?:[一二三四五六七八九十]+|\d+)[、.．]\s*/.test(value.trim());
}

function cleanSectionTitle(value: string): string {
  return value.replace(/^(?:[一二三四五六七八九十]+|\d+)[、.．]\s*/, '').trim();
}

function navigationLabel(title: string): string {
  const labels: Array<[string, string]> = [
    ['值得搞明白', '要点'], ['今日要点', '要点'], ['邮箱', '邮箱'], ['市场', '市场'], ['雷达', '市场'],
    ['AI', 'AI'], ['技术', '技术'], ['工具', '工具'], ['GitHub', '工具'], ['为什么', '为什么'], ['行动', '行动'], ['复盘', '复盘'], ['风险', '风险'],
  ];
  return labels.find(([marker]) => title.includes(marker))?.[1] ?? cleanSectionTitle(title).slice(0, 8);
}

function renderNavigation(entries: Array<{ line: number; title: string }>): string {
  const links = entries.map((entry, index) => `<a href="#section-${index + 1}" target="_self" style="display:inline-block;margin:4px 5px 4px 0;padding:7px 11px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#174b4c;font-size:13px;font-weight:850;text-decoration:none;"><span style="color:#7b8798;margin-right:5px;">${String(index + 1).padStart(2, '0')}</span>${renderInline(navigationLabel(entry.title))}</a>`).join('');
  return `<nav id="report-toc" aria-label="日报章节导航" style="margin:0 0 22px;padding:11px 13px;border:1px solid #d7e0e4;border-radius:13px;background:#f4f7f8;"><span style="display:block;margin-bottom:3px;color:#526174;font-size:11px;font-weight:900;letter-spacing:.08em;">快速跳转</span>${links}</nav>`;
}

export function renderDailyReportMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const lines = normalized.split('\n');
  const allEntries = lines.flatMap((line, lineIndex) => {
    const match = line.trim().match(/^#\s+(.+?)\s*#*$/);
    return match && isReportSectionTitle(match[1]) ? [{ line: lineIndex, title: match[1] }] : [];
  });
  const entries = allEntries.filter(entry => !entry.title.includes('工具') && !entry.title.includes('GitHub'));
  if (allEntries.length === 0) return renderBlocks(lines);
  if (entries.length === 0) return renderBlocks(lines.slice(0, allEntries[0].line));
  const blocks: string[] = [renderNavigation(entries)];
  if (allEntries[0].line > 0) blocks.push(renderBlocks(lines.slice(0, allEntries[0].line)));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const end = allEntries.find(next => next.line > entry.line)?.line ?? lines.length;
    const accent = SECTION_COLORS[index % SECTION_COLORS.length];
    const content = renderBlocks(lines.slice(entry.line + 1, end), entry.title);
    blocks.push(`<section id="section-${index + 1}" class="daily-report-section" style="scroll-margin-top:16px;margin:24px 0 28px;overflow:hidden;border:1px solid #d9e2e6;border-radius:16px;background:#fff;">` +
      `<h2 style="margin:0;padding:14px 16px;background:${accent};color:#fff;font-size:21px;line-height:1.35;"><span style="opacity:.72;font-size:12px;letter-spacing:.08em;margin-right:9px;">${String(index + 1).padStart(2, '0')}</span>${renderInline(cleanSectionTitle(entry.title))}<a href="#report-toc" target="_self" title="返回目录" style="float:right;color:#fff;font-size:13px;text-decoration:none;">↑ 返回目录</a></h2>` +
      `<div style="padding:3px 17px 18px;">${content}</div></section>`);
  }
  return blocks.join('\n');
}
