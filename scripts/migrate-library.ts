import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type LibraryType = 'knowledge' | 'insight' | 'framework' | 'experience' | 'tutorial' | 'reference';

interface Candidate {
  sourceId: string;
  kind: 'article';
  type: LibraryType;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  sourceType: 'migration';
  sourceRef: string;
  sourceUrl?: string;
  metadata: { migrationFamily: 'knowledge' | 'tutorial'; relativePath: string };
  file: string;
  warnings: string[];
}

interface ReportItem {
  file: string;
  sourceId: string;
  type: LibraryType;
  title: string;
  status: 'ready' | 'imported' | 'failed' | 'skipped';
  entryId?: string;
  error?: string;
  warnings: string[];
}

interface MigrationReport {
  generatedAt: string;
  mode: 'dry-run' | 'import';
  roots: { knowledge: string | null; tutorial: string | null };
  scanned: number;
  ready: number;
  imported: number;
  failed: number;
  skipped: number;
  typeMapping: Record<string, number>;
  items: ReportItem[];
}

function usage(): void {
  console.log([
    '知识库迁移工具',
    '',
    '默认只 dry-run，不会写入 AI Calendar。',
    '',
    '用法：',
    '  npx tsx scripts/migrate-library.ts --dry-run --knowledge-dir <path> --tutorial-dir <path>',
    '  $env:LIBRARY_PUBLISH_TOKEN = "..."',
    '  npx tsx scripts/migrate-library.ts --import --base-url https://example.com --knowledge-dir <path> --tutorial-dir <path>',
    '',
    '可选：--report <path>；导入模式可使用环境变量 LIBRARY_BASE_URL / LIBRARY_PUBLISH_TOKEN。',
  ].join('\n'));
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--dry-run' || arg === '--import') {
      result[arg.slice(2)] = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要一个值`);
      result[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`不认识的参数：${arg}`);
  }
  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed.replace(/'/g, '"'));
      if (Array.isArray(parsed)) return [...new Set(parsed.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 30);
    } catch {}
  }
  return [...new Set(trimmed.split(/[,，\s]+/).map(item => item.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 30);
}

function parseMarkdown(filePath: string, family: 'knowledge' | 'tutorial', root: string): Candidate | null {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
  const sourceRef = `${family}/${relativePath}`;
  let content = raw.trim();
  const frontmatter: Record<string, string> = {};
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    const lines = content.split(/\r?\n/);
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
        if (match) frontmatter[match[1]] = match[2];
      }
      content = lines.slice(end + 1).join('\n').trim();
    }
  }
  const declaredSourceId = unquote(frontmatter.sourceId || frontmatter.source_id || '').trim();
  const sourceId = (declaredSourceId || `migration:${family}:${crypto.createHash('sha256').update(sourceRef, 'utf8').digest('hex').slice(0, 32)}`).slice(0, 240);
  const h1 = content.match(/^#\s+(.+?)\s*#*$/m);
  const title = unquote(frontmatter.title || h1?.[1] || path.basename(filePath, path.extname(filePath))).slice(0, 240);
  if (!content) return null;
  const sourceLine = content.split(/\r?\n/).find(line => /^>\s*来源[：:]/.test(line));
  const sourceUrl = sourceLine?.match(/https?:\/\/[^\s|)>]+/)?.[0];
  const inlineTags = sourceLine?.match(/标签[：:]\s*([^|]+)/)?.[1];
  const summary = unquote(frontmatter.summary || content
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .find(block => block && !block.startsWith('#') && !block.startsWith('>') && !block.startsWith('---'))
    ?.replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 180) || '');
  const tags = parseTags(frontmatter.tags || inlineTags);
  const type: LibraryType = family === 'knowledge'
    ? relativePath.startsWith('框架/') ? 'framework'
      : relativePath.startsWith('认知/') ? 'insight'
        : relativePath.startsWith('经历/') ? 'experience' : 'knowledge'
    : /速查|手册|工具箱|攻略/u.test(path.basename(filePath)) ? 'reference' : 'tutorial';
  const warnings: string[] = [];
  if (!frontmatter.title && !h1) warnings.push('title_from_filename');
  if (!frontmatter.summary) warnings.push('summary_from_content');
  if (family === 'tutorial' && !sourceUrl) warnings.push('source_url_not_found');
  return {
    sourceId,
    kind: 'article',
    type,
    title,
    summary,
    content,
    tags,
    sourceType: 'migration',
    sourceRef,
    ...(sourceUrl ? { sourceUrl } : {}),
    metadata: { migrationFamily: family, relativePath },
    file: filePath,
    warnings,
  };
}

function collectMarkdown(rootValue: string | undefined, family: 'knowledge' | 'tutorial'): Candidate[] {
  if (!rootValue) return [];
  const root = path.resolve(rootValue);
  if (!fs.existsSync(root)) throw new Error(`目录不存在：${root}`);
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(full);
    }
  };
  walk(root);
  return files
    .filter(file => !/^(README|HANDOFF)\.md$/i.test(path.basename(file)))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map(file => parseMarkdown(file, family, root))
    .filter((item): item is Candidate => Boolean(item));
}

function toReportItem(candidate: Candidate, status: ReportItem['status'], extra: Partial<ReportItem> = {}): ReportItem {
  return {
    file: candidate.file,
    sourceId: candidate.sourceId,
    type: candidate.type,
    title: candidate.title,
    status,
    warnings: candidate.warnings,
    ...extra,
  };
}

async function importCandidate(baseUrl: string, token: string, candidate: Candidate): Promise<{ entryId: string; status: string }> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/integrations/library`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: candidate.kind,
      type: candidate.type,
      sourceId: candidate.sourceId,
      title: candidate.title,
      summary: candidate.summary,
      content: candidate.content,
      tags: candidate.tags,
      sourceType: candidate.sourceType,
      sourceRef: candidate.sourceRef,
      sourceUrl: candidate.sourceUrl,
      metadata: candidate.metadata,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`);
  return { entryId: String(payload.entry?.id || ''), status: String(payload.status || 'UNKNOWN') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const importing = args.import === true;
  const knowledgeDir = typeof args['knowledge-dir'] === 'string' ? args['knowledge-dir'] : undefined;
  const tutorialDir = typeof args['tutorial-dir'] === 'string' ? args['tutorial-dir'] : undefined;
  if (!knowledgeDir && !tutorialDir) throw new Error('至少提供 --knowledge-dir 或 --tutorial-dir');
  const candidates = [
    ...collectMarkdown(knowledgeDir, 'knowledge'),
    ...collectMarkdown(tutorialDir, 'tutorial'),
  ];
  const report: MigrationReport = {
    generatedAt: new Date().toISOString(),
    mode: importing ? 'import' : 'dry-run',
    roots: { knowledge: knowledgeDir ? path.resolve(knowledgeDir) : null, tutorial: tutorialDir ? path.resolve(tutorialDir) : null },
    scanned: candidates.length,
    ready: importing ? 0 : candidates.length,
    imported: 0,
    failed: 0,
    skipped: 0,
    typeMapping: {},
    items: [],
  };
  for (const candidate of candidates) report.typeMapping[candidate.type] = (report.typeMapping[candidate.type] || 0) + 1;

  if (!importing) {
    report.items = candidates.map(candidate => toReportItem(candidate, 'ready'));
  } else {
    const baseUrl = String(args['base-url'] || process.env.LIBRARY_BASE_URL || '').trim();
    const token = String(args.token || process.env.LIBRARY_PUBLISH_TOKEN || '').trim();
    if (!baseUrl) throw new Error('导入模式需要 --base-url 或 LIBRARY_BASE_URL');
    if (!token) throw new Error('导入模式需要 LIBRARY_PUBLISH_TOKEN；不要把令牌写入仓库或报告');
    for (const candidate of candidates) {
      try {
        const imported = await importCandidate(baseUrl, token, candidate);
        report.imported += 1;
        report.items.push(toReportItem(candidate, 'imported', { entryId: imported.entryId, warnings: [...candidate.warnings, `publish_${imported.status.toLowerCase()}`] }));
      } catch (error) {
        report.failed += 1;
        report.items.push(toReportItem(candidate, 'failed', { error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
  const reportPath = typeof args.report === 'string' ? path.resolve(args.report) : null;
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (report.failed > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
