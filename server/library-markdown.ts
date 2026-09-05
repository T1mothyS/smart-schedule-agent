import { escapeHtml } from './markdown-renderer.js';

function isSafeUrl(value: string): boolean {
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url) || url.startsWith('//')) return false;
  if (url.startsWith('/') || url.startsWith('#') || url.startsWith('./') || url.startsWith('../')) return true;
  try {
    const parsed = new URL(url, 'https://invalid.local');
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

function renderInline(value: string): string {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__/g;
  let output = '';
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    output += escapeHtml(value.slice(cursor, index));
    if (match[1] !== undefined) {
      const alt = escapeHtml(match[1]);
      const src = match[2];
      output += isSafeUrl(src)
        ? `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />`
        : `<span class="library-unsafe-link">${alt}</span>`;
    } else if (match[3] !== undefined) {
      const label = escapeHtml(match[3]);
      const href = match[4];
      output += isSafeUrl(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : `<span class="library-unsafe-link">${label}</span>`;
    } else if (match[5] !== undefined) {
      output += `<code>${escapeHtml(match[5])}</code>`;
    } else {
      output += `<strong>${escapeHtml(match[6] ?? match[7] ?? '')}</strong>`;
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
  return `<div class="library-table-wrap"><table><thead><tr>${headers.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(cells => {
    return `<tr>${headers.map((_header, index) => `<td>${renderInline(cells[index] || '')}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderList(lines: string[], ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul';
  const items = lines.map(line => line.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, ''));
  return `<${tag}>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`;
}

export function renderLibraryMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim().replace(/[^a-zA-Z0-9_-]/g, '');
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const list: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        list.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(list, false));
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const list: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        list.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(list, true));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && line.includes('|') && isTableSeparator(lines[index + 1])) {
      const header = line;
      const rows: string[] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(lines[index]);
        index += 1;
      }
      blocks.push(renderTable(header, rows));
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && (/^(#{1,6})\s+/.test(lines[index]) || /^```/.test(lines[index].trim()) || /^\s*[-*+]\s+/.test(lines[index]) || /^\s*\d+[.)]\s+/.test(lines[index]) || /^>\s?/.test(lines[index]))) break;
      if (paragraph.length && index + 1 < lines.length && lines[index].includes('|') && isTableSeparator(lines[index + 1])) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
  }
  return blocks.join('\n');
}
