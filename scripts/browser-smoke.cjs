// Optional local smoke: built dist + externally provided Playwright; no live backend.
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || '.'), out = process.env.BROWSER_SMOKE_OUTPUT || fs.mkdtempSync(path.join(require('os').tmpdir(), 'aicalendar-browser-'));
console.log('Synthetic smoke output:', out);
fs.mkdirSync(out, { recursive: true });
const entry = (id) => ({ id, kind: 'article', type: 'knowledge', sourceId: id, slug: id, title: id === 'rich' ? '公式与流程图' : '普通文章', summary: '本地合成验收数据', content: 'source', html: id === 'rich' ? '<h2>公式与流程图</h2><div data-library-math="display"><span class="library-rich-content-source">x^2+1</span></div><div data-library-mermaid><span class="library-rich-content-source">graph TD; A[开始]--&gt;B[完成]</span></div>' : '<h2>普通内容</h2><p>阅读器分包验收</p>', tags: [], status: 'active', sourceType: 'codex', sourceRef: null, sourceUrl: null, metadata: {}, relations: [], contentHash: 'synthetic', createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z', publishedAt: null, archivedAt: null });
const seen = new Set(), errors = [], checks = [];
const emptyApis = new Set(['/api/action-center', '/api/notifications', '/api/schedules', '/api/cycle-reminders', '/api/ai-schedule/history', '/api/note-items', '/api/daily-reports', '/api/check-login', '/api/user-api-key', '/api/notification-preferences', '/api/integrations/daily-report-token', '/api/daily-report/cloud-context', '/api/daily-report/delivery-policy', '/api/integrations/library-token', '/api/user-mail-account', '/api/admin/users']);
const server = http.createServer((req, res) => { let file = path.join(root, 'dist', new URL(req.url, 'http://local').pathname); if (!file.startsWith(path.join(root, 'dist') + path.sep)) {
    res.writeHead(403);
    return res.end();
} if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(root, 'dist/index.html'); res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); });
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const context = await browser.newContext();
        await context.addInitScript(() => localStorage.setItem('aicalendar_token', 'synthetic-browser-only'));
        await context.route('**/*', async (route) => {
            const u = new URL(route.request().url());
            if (u.origin !== base)
                return route.abort();
            if (!u.pathname.startsWith('/api/'))
                return route.continue();
            seen.add(u.pathname);
            let body = {};
            const p = u.pathname;
            if (p === '/api/auth/me')
                body = { user: { id: 'synthetic', email: 'test@example.invalid', role: 'admin' } };
            else if (p === '/api/library/preferences')
                body = { preference: { sort: 'created_desc' } };
            else if (p === '/api/library')
                body = { items: [entry('plain'), entry('rich')], total: 2 };
            else if (p.startsWith('/api/library/'))
                body = { entry: entry(p.split('/').pop()), versions: [], comments: [], relations: { items: [], calendarEvents: [], libraryEntries: [] } };
            else if (p === '/api/admin/invite-codes')
                body = { codes: [] };
            else if (p === '/api/models')
                body = { models: [] };
            else if (p === '/api/ai-linkage-guides')
                body = { title: '合成指南', version: 'test', items: [], rules: [], examples: [] };
            else if (p === '/api/schedule-model')
                body = { model: 'glm-5.1' };
            else if (!emptyApis.has(p))
                throw Error('Unspecified synthetic API: ' + p);
            else
                body = { schedules: [], tasks: [], notifications: [], items: [], reports: [], messages: [], users: [], logs: [], total: 0 };
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error')
            console.log('BROWSER ERROR', m.text()); });
        const assets = [];
        page.on('request', r => { if (r.url().includes('/assets/'))
            assets.push(r.url().split('/').pop()); });
        for (const width of [390, 430, 768, 1440]) {
            await page.setViewportSize({ width, height: width === 768 ? 1024 : width === 1440 ? 900 : width === 430 ? 932 : 844 });
            for (const [url, label] of [['/today', '今日'], ['/schedule', '日程'], ['/reminders', '周期提醒'], ['/assistant', 'AI 对话'], ['/reports', '日报'], ['/library', '知识库']]) {
                await page.goto(base + url);
                await page.getByRole('button', { name: label, exact: true }).waitFor();
                await page.waitForTimeout(350);
                if (await page.getByText('页面加载失败，请刷新后重试。').count())
                    throw Error('route failed ' + url);
                checks.push({ width, url, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
            }
            await page.getByRole('button', { name: '打开设置', exact: true }).click();
            await page.locator('.settings-dialog-frame').waitFor();
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(out, `settings-${width}.png`) });
            await page.getByRole('button', { name: '关闭设置', exact: true }).click();
            await page.getByRole('button', { name: '打开管理面板', exact: true }).click();
            await page.locator('.admin-modal').waitFor();
            await page.screenshot({ path: path.join(out, `admin-${width}.png`) });
            await page.getByRole('button', { name: '关闭管理面板', exact: true }).click();
            await page.getByRole('button', { name: '切换主题', exact: true }).click();
            await page.getByRole('button', { name: '打开设置', exact: true }).click();
            await page.locator('.settings-dialog-frame').waitFor();
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(out, `settings-dark-${width}.png`) });
            await page.getByRole('button', { name: '关闭设置', exact: true }).click();
            await page.getByRole('button', { name: '切换主题', exact: true }).click();
        }
        assets.length = 0;
        await page.goto(base + '/library/plain');
        await page.getByText('阅读器分包验收').waitFor();
        await page.waitForTimeout(400);
        if (assets.some(a => /katex|mermaid/i.test(a)))
            throw Error('plain loaded rich deps');
        checks.push({ plainRichAssets: 0 });
        await page.goto(base + '/library/rich');
        await page.locator('.katex').waitFor();
        await page.getByLabel('Mermaid 流程图').waitFor();
        await page.screenshot({ path: path.join(out, 'rich-light.png') });
        await page.getByRole('button', { name: '切换主题', exact: true }).click();
        await page.waitForTimeout(500);
        await page.getByLabel('Mermaid 流程图').waitFor();
        await page.screenshot({ path: path.join(out, 'rich-dark.png') });
        checks.push({ rich: true });
        await page.goto(base + '/schedule?date=2026-12-25');
        await page.locator('.calendar-toolbar-date-full').waitFor();
        if (!(await page.locator('.calendar-toolbar-date-full').innerText()).includes('12'))
            throw Error('date deep link failed');
        await page.getByRole('button', { name: '添加日程', exact: true }).click();
        await page.getByPlaceholder('输入日程标题...').fill('合成草稿');
        await page.waitForTimeout(200);
        if (await page.getByPlaceholder('输入日程标题...').inputValue() !== '合成草稿')
            throw Error('draft lost');
        await page.screenshot({ path: path.join(out, 'schedule-draft.png') });
        await page.locator('.schedule-form-modal button').first().click();
        checks.push({ dateDeepLink: true, scheduleDraft: true });
        await page.goto(base + '/today');
        const trigger = page.getByRole('button', { name: '打开设置', exact: true });
        await trigger.click();
        await page.locator('.settings-dialog-frame').waitFor();
        await page.waitForTimeout(600);
        await page.keyboard.press('Escape');
        await page.locator('.settings-dialog-frame').waitFor({ state: 'detached' });
        if (!await trigger.evaluate(el => el === document.activeElement))
            throw Error('settings focus not restored');
        checks.push({ settingsEscapeFocus: true });
        await page.getByRole('button', { name: '知识库', exact: true }).click();
        await page.getByText('普通文章', { exact: true }).waitFor();
        await page.getByText('普通文章', { exact: true }).click();
        await page.getByText('阅读器分包验收').waitFor();
        await page.goBack();
        await page.getByText('普通文章', { exact: true }).waitFor();
        checks.push({ clientNavigationBack: true });
        await context.close();
        for (const mode of ['slow', 'failure', 'math-failure']) {
            const c = await browser.newContext();
            await c.addInitScript(() => localStorage.setItem('aicalendar_token', 'synthetic-browser-only'));
            await c.route('**/*', async (r) => { const u = new URL(r.request().url()); if (u.origin !== base)
                return r.abort(); if (u.pathname.startsWith('/api/')) {
                const body = u.pathname === '/api/auth/me' ? { user: { id: 'synthetic', email: 'test@example.invalid', role: 'admin' } } : u.pathname === '/api/library/rich' ? { entry: entry('rich'), versions: [], comments: [], relations: { items: [], calendarEvents: [], libraryEntries: [] } } : {};
                return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            } if (mode === 'math-failure' && /katex-renderer.*\.js/.test(u.pathname))
                return r.abort(); if (/SettingsDialog.*\.js/.test(u.pathname)) {
                if (mode === 'failure')
                    return r.abort();
                if (mode === 'slow')
                    await new Promise(resolve => setTimeout(resolve, 1500));
            } return r.continue(); });
            const p = await c.newPage();
            await p.goto(base + (mode === 'math-failure' ? '/library/rich' : '/today'));
            if (mode === 'math-failure') {
                await p.getByText('公式组件加载失败，已保留原始公式源码。').waitFor();
                await p.getByLabel('Mermaid 流程图').waitFor();
            }
            else {
                await p.getByRole('button', { name: '打开设置', exact: true }).click();
                await p.getByRole('button', { name: '取消', exact: true }).waitFor();
                if (mode === 'failure')
                    await p.getByText('页面加载失败，请刷新后重试。').waitFor();
                await p.keyboard.press('Tab');
                if (!await p.getByRole('dialog', { name: '加载弹窗' }).evaluate(el => el.contains(document.activeElement)))
                    throw Error('fallback focus escaped');
                await p.keyboard.press('Escape');
                await p.getByRole('dialog', { name: '加载弹窗' }).waitFor({ state: 'detached' });
            }
            checks.push({ mode, passed: true });
            await c.close();
        }
        fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, errors, apis: [...seen], assets }, null, 2));
        console.log(JSON.stringify({ checks, errors, apis: [...seen] }));
        if (errors.length || checks.some(c => c.overflow))
            process.exitCode = 1;
    }
    finally {
        await browser.close();
        server.close();
    }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
