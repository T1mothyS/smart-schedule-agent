// Local built-page checks. Synthetic account/API only; no production or personal data.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const data = JSON.parse(fs.readFileSync(path.join(root, 'project-evolution/generated.json'), 'utf8'));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-evolution-browser-'));
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.resolve(dist, '.' + new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(dist + path.sep)) { res.writeHead(403); return res.end(); }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream'); res.end(fs.readFileSync(target));
});
const errors = [], checks = [];
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let mode = 'normal';
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('aicalendar_token', 'synthetic-only'));
    const api = async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const p = url.pathname; let body = {};
      if (p === '/api/project-evolution') {
        if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'synthetic failure' } });
        if (mode === 'slow') await new Promise(r => setTimeout(r, 900));
        body = structuredClone(data);
        if (mode === 'empty') { body.milestones = []; body.facts = []; body.snapshots = []; }
        if (mode === 'long') body.milestones.at(-1).title = '超长项目历史标题与架构变更说明'.repeat(12);
      } else if (p === '/api/auth/me') body = { user: { id: 'synthetic', email: 'test@example.invalid', role: 'user' } };
      else if (p === '/api/auth/login') body = { token: 'synthetic-only', user: { id: 'synthetic', email: 'test@example.invalid', role: 'user' } };
      else if (p === '/api/tools') body = { tools: [{ slug: 'example', title: '合成测试工具', summary: '菜单回归', path: '/tools/example/', kind: 'mounted' }] };
      else if (p === '/api/ai-linkage-guides') body = { title: '合成指南', version: 'test', items: [], rules: [], examples: [] };
      else if (p === '/api/models') body = { models: [] };
      else if (p === '/api/schedule-model') body = { model: 'glm-5.1' };
      else if (p === '/api/user-mail-account') body = { account: { configured: false, enabled: true, username: '', encryptionConfigured: false } };
      else if (p === '/api/notification-preferences') body = { preference: {} };
      else if (p.startsWith('/api/integrations/caldav/')) body = { enabled: false, writeEnabled: false, mode: 'full-one-way', automationAvailable: false };
      else body = { schedules: [], tasks: [], notifications: [], items: [], reports: [], messages: [], users: [], logs: [], total: 0 };
      return route.fulfill({ status: 200, json: body });
    };
    await context.route('**/*', api);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const assets = []; page.on('request', r => { if (r.url().includes('/assets/')) assets.push(r.url()); });
    const noOverflow = async label => {
      const widths = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert.ok(widths[0] <= widths[1] + 1, `${label}: ${widths}`); checks.push(label);
    };
    await page.goto(base + '/tools'); await page.getByText('合成测试工具', { exact: true }).waitFor();
    assert.ok(!assets.some(a => a.includes('ProjectEvolutionPage'))); checks.push('project assets not loaded on tools');
    for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => localStorage.setItem('theme', theme), theme);
        await page.goto(base + '/project'); await page.getByRole('heading', { name: '继续打磨正确性与诊断', exact: true }).waitFor();
        assert.equal(await page.title(), 'AI Calendar - 项目成长');
        assert.equal(await page.locator('html').evaluate(e => e.classList.contains('dark')), theme === 'dark');
        await noOverflow(`${width} ${theme} growth`);
        const scroller = page.locator('.evolution-page');
        await scroller.hover(); await page.mouse.wheel(0, 600);
        await page.waitForFunction(() => document.querySelector('.evolution-page').scrollTop > 0);
        await scroller.evaluate(e => { e.tabIndex = 0; e.focus(); });
        await page.keyboard.press('Control+End');
        await page.waitForFunction(() => { const e = document.querySelector('.evolution-page'); return e.scrollTop + e.clientHeight >= e.scrollHeight - 2; });
        checks.push(`${width} ${theme} wheel and keyboard bottom reachable`);
        await scroller.evaluate(e => { e.scrollTop = 0; });

        await page.screenshot({ path: path.join(output, `${width}-${theme}-growth.png`), fullPage: true });
        await page.locator('.evolution-detail').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-detail.png`) });
        await page.getByRole('button', { name: '打开设置', exact: true }).click();
        await page.locator('.settings-header-links').waitFor();
        await page.waitForTimeout(400); // TDesign opening transition must finish before visual evidence.
        await noOverflow(`${width} ${theme} settings`);
        const close = await page.getByRole('button', { name: '关闭设置', exact: true }).boundingBox();
        assert.ok(close && close.x + close.width <= width && close.y + close.height <= height);
        await page.screenshot({ path: path.join(output, `${width}-${theme}-settings.png`) });
        if (width === 1440) await page.locator('.settings-dialog-toolbar').screenshot({ path: path.join(output, `${theme}-settings-header.png`) });
        await page.locator('.settings-header-links').getByRole('button', { name: 'Tools 工具中心', exact: true }).click();
        await page.getByText('合成测试工具', { exact: true }).waitFor();
        await page.getByRole('button', { name: '打开设置', exact: true }).click();
        await page.locator('.settings-header-links').getByRole('button', { name: '项目成长', exact: true }).click();
        await page.getByRole('heading', { name: '继续打磨正确性与诊断', exact: true }).waitFor();
        await page.getByRole('button', { name: '架构演化', exact: true }).click();
        await page.getByRole('heading', { name: '这一刻，系统怎样连接', exact: true }).waitFor();
        await page.locator('#evolution-milestone').selectOption('retrieval');
        await page.locator('.evolution-node-list').getByRole('button', { name: '知识检索 新增' }).click();
        assert.match(await page.locator('.evolution-node-detail').innerText(), /新增/);
        await noOverflow(`${width} ${theme} architecture`);
        if (width < 640) await page.getByRole('button', { name: '展开完整图' }).click();
        await page.getByRole('button', { name: '缩小架构图' }).click();
        await page.getByRole('button', { name: '复位', exact: true }).click();
        await page.locator('.evolution-map-scroll').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-architecture.png`), fullPage: true });
        await page.reload(); await page.locator('#evolution-milestone').waitFor();
        assert.equal(await page.locator('#evolution-milestone').inputValue(), 'retrieval');
        assert.ok(await page.getByRole('heading', { name: '这一刻，系统怎样连接', exact: true }).isVisible());
      }
    }
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await touchContext.addInitScript(() => localStorage.setItem('aicalendar_token', 'synthetic-only'));
    await touchContext.route('**/*', api);
    const touchPage = await touchContext.newPage(); await touchPage.goto(base + '/project');
    await touchPage.locator('.evolution-page').waitFor();
    const cdp = await touchContext.newCDPSession(touchPage);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 700 }] });
    for (const y of [600, 450, 300, 180]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 190, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForFunction(() => document.querySelector('.evolution-page').scrollTop > 0);
    checks.push('mobile touch scroll moves page'); await touchContext.close();
    await page.locator('#evolution-milestone').selectOption('cloud');
    await page.goBack(); assert.equal(await page.locator('#evolution-milestone').inputValue(), 'retrieval');
    await page.goForward(); assert.equal(await page.locator('#evolution-milestone').inputValue(), 'cloud'); checks.push('history navigation and deep link');
    await page.getByRole('button', { name: '成长历程', exact: true }).click();
    await page.locator('#evolution-milestone').selectOption('baseline');
    await page.locator('.evolution-day-toggle').first().click();
    assert.equal(await page.locator('.evolution-day-toggle').first().getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.evolution-stop.is-selected button[aria-pressed=true]').count(), 3);
    await page.locator('.evolution-day-toggle').first().click();
    assert.equal(await page.locator('.evolution-day-toggle').first().getAttribute('aria-expanded'), 'true'); checks.push('same-day grouping and synchronized three tracks');
    await page.goto(base + '/project?view=invalid&milestone=missing'); await page.getByText('链接中的选择无效', { exact: false }).waitFor();
    await page.getByRole('button', { name: '重置链接' }).click(); checks.push('invalid query reset');
    await page.locator('#evolution-milestone').selectOption('baseline'); await page.getByText('工程细节与证据', { exact: false }).click();
    assert.match(await page.locator('.evolution-detail').innerText(), /本地测试数量未记录/);
    await page.getByRole('button', { name: '打开设置' }).click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开设置'); checks.push('Escape restores keyboard focus');
    for (const state of ['error', 'empty', 'slow', 'long']) {
      mode = state; await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + '/project');
      if (state === 'error') { await page.getByText('暂时没有读到成长记录', { exact: true }).waitFor(); mode = 'normal'; await page.getByRole('button', { name: '重新加载' }).click(); await page.locator('#evolution-milestone').waitFor(); }
      if (state === 'empty') await page.getByText('还没有可展示的里程碑。', { exact: true }).waitFor();
      if (state === 'slow') { await page.getByText('正在读取项目历史…', { exact: true }).waitFor(); await page.locator('#evolution-milestone').waitFor(); }
      if (state === 'long') await page.locator('#evolution-milestone').waitFor();
      await noOverflow(state);
    }
    mode = 'normal';
    const loginContext = await browser.newContext(); await loginContext.route('**/*', api);
    const login = await loginContext.newPage();
    login.on('pageerror', e => errors.push(e.message));
    await login.goto(base + '/project?view=architecture&milestone=cloud');
    await login.getByPlaceholder('请输入邮箱地址').fill('test@example.invalid'); await login.locator('input[type=password]').fill('synthetic-password');
    await login.locator('form button[type=submit]').click();
    try { await login.locator('#evolution-milestone').waitFor(); }
    catch (error) { await login.screenshot({ path: path.join(output, 'login-failure.png') }); console.log({ loginUrl: login.url(), body: await login.locator('body').innerText(), errors }); throw error; }
    assert.equal(await login.locator('#evolution-milestone').inputValue(), 'cloud');
    assert.ok(login.url().includes('view=architecture')); checks.push('login retains deep link');
    await loginContext.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checks, errors, boundary: 'Built UI and synthetic APIs; real authentication covered by server tests.' }, null, 2));
    console.log(JSON.stringify({ output, checks: checks.length, errors }));
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
