// Optional local smoke: built dist, protected-tools content and synthetic APIs.
// It never connects to the production service or uses a real account.
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(process.argv[2] || '.');
const output = process.env.BROWSER_SMOKE_OUTPUT || fs.mkdtempSync(path.join(require('os').tmpdir(), 'aicalendar-tools-browser-'));
const distRoot = path.join(root, 'dist');
const toolsRoot = path.join(root, 'protected-tools');
const manifest = JSON.parse(fs.readFileSync(path.join(toolsRoot, 'manifest.json'), 'utf8'));
const publicTools = manifest.tools.filter(tool => tool.enabled !== false).map(tool => ({
  slug: tool.slug, title: tool.title, summary: tool.summary, path: `/tools/${tool.slug}/`, kind: 'mounted',
}));
const errors = [], checks = [];
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function sendJson(res, value) {
  const body = JSON.stringify(value);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, filename, headers = {}) {
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': `${mime[path.extname(filename)] || 'application/octet-stream'}; charset=UTF-8`, ...headers });
  res.end(fs.readFileSync(filename));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://local');
  const pathname = url.pathname;
  if (pathname === '/api/auth/me') return sendJson(res, { user: { id: 'synthetic', email: 'test@example.invalid', role: 'admin' } });
  if (pathname === '/api/tools') return sendJson(res, { tools: publicTools });
  if (pathname === '/api/ai-linkage-guides') return sendJson(res, { title: '合成指南', version: 'test', items: [], rules: [], examples: [] });
  if (pathname === '/api/schedule-model') return sendJson(res, { model: 'glm-5.1' });
  if (pathname === '/api/models') return sendJson(res, { models: [] });
  if (pathname === '/api/user-api-key') return sendJson(res, { baseUrl: '' });
  if (pathname === '/api/check-login') return sendJson(res, { isLoggedIn: false, hasApiKey: false, usingSharedApi: false });
  if (pathname === '/api/notification-preferences') return sendJson(res, { preference: {} });
  if (pathname === '/api/integrations/daily-report-token') return sendJson(res, { status: { exists: false, active: false } });
  if (pathname === '/api/daily-report/delivery-policy') return sendJson(res, { sources: ['local'], updatedAt: null });
  if (pathname === '/api/daily-report/cloud-context') return sendJson(res, { context: null });
  if (pathname === '/api/integrations/library-token') return sendJson(res, { status: { exists: false, active: false } });
  if (pathname === '/api/user-mail-account') return sendJson(res, { account: { configured: false, enabled: true, username: '', encryptionConfigured: false } });
  if (pathname.startsWith('/api/')) return sendJson(res, {});

  const toolMatch = pathname.match(/^\/tools\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/.*)?$/);
  if (toolMatch) {
    const slug = toolMatch[1];
    if (!publicTools.some(tool => tool.slug === slug)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      return res.end('工具不存在');
    }
    const toolPrefix = `/tools/${slug}/`;
    const relative = pathname.slice(toolPrefix.length);
    if (!pathname.endsWith('/') && !relative) {
      res.writeHead(308, { Location: `/tools/${slug}/` });
      return res.end();
    }
    const toolDirectory = path.resolve(toolsRoot, slug);
    const filename = path.resolve(toolDirectory, relative || 'index.html');
    if (!filename.startsWith(toolDirectory + path.sep)) {
      res.writeHead(404);
      return res.end();
    }
    const tool = manifest.tools.find(candidate => candidate.slug === slug);
    const csp = tool?.cspProfile === 'plotly-alipay'
      ? "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.plot.ly; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src https://render.alipay.com"
      : "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'";
    return sendFile(res, filename, { 'Cache-Control': 'private, no-store', 'Content-Security-Policy': csp });
  }

  let filename = path.resolve(distRoot, `.${pathname}`);
  if (!filename.startsWith(distRoot + path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(distRoot, 'index.html');
  return sendFile(res, filename);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    fs.mkdirSync(output, { recursive: true });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('aicalendar_token', 'synthetic-browser-only');
      window.Plotly = { newPlot() { return Promise.resolve(); } };
      window.__toolsLastDownloadName = '';
      const anchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__toolsLastDownloadName = this.download;
        return anchorClick.call(this);
      };
    });
    await context.route('**/*', async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === base) return route.continue();
      if (requestUrl.origin === 'https://cdn.plot.ly') {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: 'window.Plotly = window.Plotly || { newPlot() { return Promise.resolve(); } };',
        });
      }
      if (requestUrl.origin === 'https://render.alipay.com') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>Synthetic Alipay frame</title>',
        });
      }
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', dialog => dialog.accept());

    for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/tools`);
      await page.getByRole('heading', { name: 'Tools', exact: true }).waitFor();
      await page.getByText('挂载应用 · 非主站核心功能', { exact: true }).waitFor();
      if (await page.getByRole('button', { name: 'Tools', exact: true }).count()) throw Error('Tools entered product navigation');
      if (await page.locator('.tools-card').count() !== publicTools.length) throw Error('Tools manifest cards mismatch');
      await page.locator('.tools-open-action').first().focus();
      if (!await page.locator('.tools-open-action').first().evaluate(element => element === document.activeElement)) throw Error('Tools keyboard focus failed');
      checks.push({ width, toolsCards: publicTools.length, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
      await page.screenshot({ path: path.join(output, `tools-${width}-light.png`) });

      await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await page.screenshot({ path: path.join(output, `tools-${width}-dark.png`) });
      await page.getByRole('button', { name: '切换主题', exact: true }).click();

      await page.goto(`${base}/today`);
      await page.getByRole('button', { name: '打开设置', exact: true }).click();
      await page.locator('.settings-dialog-frame').waitFor();
      const toolsSection = page.locator('#settings-tools');
      const settingsScroll = page.locator('.settings-scroll');
      await settingsScroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await toolsSection.waitFor();
      await page.getByRole('button', { name: '打开 Tools', exact: true }).click();
      await page.getByRole('heading', { name: 'Tools', exact: true }).waitFor();
      checks.push({ width, settingsToTools: true });
    }

    const openTool = async (slug) => {
      await page.goto(`${base}/tools`);
      await page.locator(`[data-tool-slug="${slug}"] .tools-open-action`).click();
      await page.waitForURL(new RegExp(`/tools/${slug}/$`));
    };
    await openTool('pelican-bicycle');
    await page.locator('#scene').waitFor();
    await page.getByRole('button', { name: '暂停动画', exact: true }).click();
    checks.push({ pelican: true });

    await openTool('alipay-growth-planner');
    await page.getByText('支付宝会员成长值预测器', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: '规则说明', exact: true }).click();
    await page.getByText('本页本地保存的是可计算的逐条整理版', { exact: false }).waitFor();
    await page.getByRole('button', { name: '成长值测算', exact: true }).click();
    await page.getByRole('button', { name: '保存参数', exact: true }).click();
    if (await page.evaluate(() => !localStorage.getItem('alipayGrowthPlanner.v4'))) throw Error('Alipay local save failed');
    checks.push({ alipay: true, alipayLocalSave: true });

    await openTool('poker-tracker');
    await page.getByRole('heading', { name: /扑克牌收集追踪/ }).waitFor();
    await page.locator('#cardGrid .card').first().click();
    if ((await page.locator('#progressCount').innerText()) !== '1') throw Error('Poker card toggle failed');
    await page.getByRole('button', { name: '批量识别', exact: true }).click();
    await page.locator('#batchInput').fill('红桃 4，黑桃 3');
    await page.getByRole('button', { name: '识别并导入', exact: true }).click();
    if ((await page.locator('#progressCount').innerText()) !== '3') throw Error('Poker batch import failed');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByText('已导出备份文件', { exact: true }).waitFor();
    if (!await page.evaluate(() => window.__toolsLastDownloadName.endsWith('.json'))) throw Error('Poker export failed');
    await page.locator('#importInput').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, profiles: [{ id: 'imported', name: '导入档案', collected: [], createdAt: Date.now() }], currentId: 'imported' })) });
    await page.getByText('导入档案', { exact: true }).waitFor();
    checks.push({ poker: true, pokerBatch: true, pokerExport: true, pokerImport: true });

    await openTool('codex-usage-dashboard-v3-1');
    await page.locator('#sampleBtn').click();
    await page.locator('#rangeSeg button[data-r="7"]').click();
    await page.locator('#fileInput').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ daily: [{ date: '2026-09-20', inputTokens: 100, outputTokens: 20, totalTokens: 120, costUSD: 0.01 }] })) });
    await page.locator('#statusText').filter({ hasText: '已导入' }).waitFor();
    await page.locator('#copyMdBtn').click();
    await page.locator('#exportTokenPng').click();
    if (!await page.evaluate(() => window.__toolsLastDownloadName.endsWith('.png'))) throw Error('Usage chart export failed');
    checks.push({ usageDashboardImport: true, usageDashboardCopy: true, usageDashboardExport: true });

    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(JSON.stringify({ checks, errors }));
    if (errors.length || checks.some(check => check.overflow)) process.exitCode = 1;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
