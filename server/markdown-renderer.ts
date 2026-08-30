/**
 * 日报专用的最小 Markdown 渲染器。
 *
 * 这里只支持日报实际使用的标题、段落、粗体、链接和表格。
 * 所有原始文本先经过转义，链接只允许安全协议，避免把外部日报内容
 * 当作 HTML 或脚本执行。网站和邮件共用这一份渲染结果。
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeLink(value: string): boolean {
  const link = value.trim();
  if (!link || /[\u0000-\u001f\u007f]/.test(link)) return false;
  if (link.startsWith('//')) return false;
  if (link.startsWith('/') || link.startsWith('#') || link.startsWith('./') || link.startsWith('../')) return true;
  try {
    const parsed = new URL(link, 'https://invalid.local');
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

function renderInline(value: string): string {
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__/g;
  let output = '';
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    output += escapeHtml(value.slice(cursor, index));
    if (match[1] !== undefined) {
      const label = escapeHtml(match[1]);
      const href = match[2];
      output += isSafeLink(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : `<span class="daily-report-unsafe-link">${label}</span>`;
    } else {
      output += `<strong>${escapeHtml(match[3] ?? match[4] ?? '')}</strong>`;
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

function renderTable(headerLine: string, rows: string[]): string {
  const headers = tableCells(headerLine);
  const body = rows.map(row => tableCells(row));
  return `<div class="daily-report-table-wrap"><table><thead><tr>${headers.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(cells => {
    const padded = headers.map((_header, index) => cells[index] || '');
    return `<tr>${padded.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1])) {
      const tableRows: string[] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        tableRows.push(lines[index]);
        index += 1;
      }
      blocks.push(renderTable(lines[index - tableRows.length - 2], tableRows));
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length > 0 && lines[index].match(/^(#{1,6})\s+/)) break;
      if (paragraph.length > 0 && index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1])) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
  }
  return blocks.join('\n');
}
