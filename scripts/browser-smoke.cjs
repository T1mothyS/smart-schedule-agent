// Optional local smoke: built dist + externally provided Playwright; no live backend.
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || '.'), out = process.env.BROWSER_SMOKE_OUTPUT || fs.mkdtempSync(path.join(require('os').tmpdir(), 'aicalendar-browser-'));
console.log('Synthetic smoke output:', out);
fs.mkdirSync(out, { recursive: true });
const entry = (id) => {
    const fixtures = {
        plain: { title: '普通文章', html: '<h2>普通内容</h2><p>阅读器分包验收</p>' },
        rich: { title: '公式与流程图', html: '<h2>公式与流程图</h2><div data-library-math="display"><span class="library-rich-content-source">x^2+1</span></div><div data-library-mermaid><span class="library-rich-content-source">graph TD; A[开始]--&gt;B[完成]</span></div>' },
        toc: { title: '目录验收文章', html: '<h2>目录验收文章</h2><p>目录和站内链接验收：<a class="library-internal-link" href="/library/target">打开跳转目标</a></p><h2>第一章</h2><div style="height: 620px"></div><h3>重复小节</h3><div style="height: 620px"></div><h3>重复小节</h3><div style="height: 620px"></div><h2>第二章</h2><p>第二章正文。</p>' },
        target: { title: '跳转目标', html: '<h2>跳转目标正文</h2><p>这是站内跳转后的目标文章。</p>' },
    };
    const fixture = fixtures[id] || fixtures.plain;
    return { id, kind: 'article', type: 'knowledge', sourceId: id, slug: id, title: fixture.title, summary: '本地合成验收数据', content: 'source', html: fixture.html, tags: [], status: 'active', sourceType: 'codex', sourceRef: null, sourceUrl: null, metadata: {}, relations: [], contentHash: 'synthetic', createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z', publishedAt: null, archivedAt: null };
};
const seen = new Set(), errors = [], checks = [];
let caldavEnabled = false, caldavFailure = false, caldavConfirmed = false;
const caldavPlan = { breakdown: { completed: 3, pending: 6, current_cycle: 1, historical_cycle: 1, disabled_cycle: 1, cancelled_cycle: 0, merged_copy: 1 }, sourceMappings: [{ sourceId: 'caldav-cycle:synthetic-history', taskId: 'synthetic-task', cycleId: 'synthetic-history', derivedSourceIds: ['reminder-cycle:synthetic-history'], current: false, status: 'completed', enabled: false, included: true }], planToken: 'a'.repeat(64), scopeVersion: 'b'.repeat(64), complete: false, counts: { event: 3, todo: 4, cycle: 2 }, exclusions: { unscheduled: 2 }, issues: [{ sourceId: 'synthetic-long-source-'.repeat(9), code: 'AMBIGUOUS_ALL_DAY_RANGE' }], operations: [{ sourceId: 'synthetic', action: 'create' }, { sourceId: 'synthetic-old', action: 'delete' }] };
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
            if (p.startsWith('/api/integrations/caldav/')) {
                await new Promise(resolve => setTimeout(resolve, 300));
                if (caldavFailure) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'CALDAV_NETWORK_ERROR' }) });
                if (p.endsWith('/preview')) body = caldavPlan;
                else if (p.endsWith('/sync')) { caldavConfirmed = true; body = { ...caldavPlan, complete: true, applied: true, issues: [] }; }
                else {
                    if (p.endsWith('/automation')) caldavEnabled = route.request().postDataJSON().enabled;
                    body = { includeCompleted: true, mode: 'full-one-way', enabled: caldavEnabled, writeEnabled: true, automationAvailable: true, busy: false, scopeVersion: caldavPlan.scopeVersion, confirmedScope: caldavConfirmed ? caldavPlan.scopeVersion : undefined, lastSuccess: '2026-09-19T01:00:00Z' };
                }
            }
            else if (p === '/api/auth/me')
                body = { user: { id: 'synthetic', email: 'test@example.invalid', role: 'admin' } };
            else if (p === '/api/library/preferences')
                body = { preference: { sort: 'created_desc' } };
            else if (p === '/api/library')
                body = { items: [entry('plain'), entry('rich'), entry('toc'), entry('target')], total: 4 };
            else if (p === '/api/ai-chat')
                body = { success: true, intent: 'chat', reply: '已找到相关知识库内容。', scheduleItems: [], knowledgeSources: [{ id: 'target', title: '合成知识库目标', sourceId: 'target', sourceType: 'synthetic', snippet: '合成来源', target: { path: '/library/target' } }], changed: false };
            else if (p.startsWith('/api/library/')) {
                const entryId = decodeURIComponent(p.split('/').pop());
                const relationItems = entryId === 'toc' ? [{ sourceId: 'toc', targetSourceId: 'target', type: 'related', label: '关联跳转目标', status: 'confirmed', targetEntryId: 'target', targetTitle: '跳转目标', targetStatus: 'active' }] : [];
                body = { entry: entry(entryId), versions: [], comments: [], relations: { items: relationItems, calendarEvents: [], libraryEntries: [] } };
            }
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
                await page.screenshot({ path: path.join(out, `route-${url.slice(1)}-${width}-light.png`) });
                await page.getByRole('button', { name: '切换主题', exact: true }).click();
                await page.waitForTimeout(200);
                await page.screenshot({ path: path.join(out, `route-${url.slice(1)}-${width}-dark.png`) });
                await page.getByRole('button', { name: '切换主题', exact: true }).click();
            }
            await page.getByRole('button', { name: '打开设置', exact: true }).click();
            await page.locator('.settings-dialog-frame').waitFor();
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(out, `settings-${width}.png`) });
            await page.locator('#settings-caldav').scrollIntoViewIfNeeded();
            const caldav = page.locator('#settings-caldav');
            await caldav.getByRole('button', { name: '预览变更', exact: true }).click();
            await caldav.getByText('存在待处理项，尚未完成全量', { exact: true }).waitFor();
            await caldav.locator('summary').filter({ hasText: '提示或待处理项' }).click();
            await caldav.locator('summary').filter({ hasText: '周期来源映射' }).click();
            await caldav.getByText(/历史 · 已完成 · 已停用/).waitFor();
            checks.push({ width, caldav: true, overflow: await caldav.evaluate(el => el.scrollWidth > el.clientWidth + 1) });
            await page.screenshot({ path: path.join(out, `caldav-${width}-light.png`) });
            if (width === 390) {
                if (!await caldav.getByRole('button', { name: '启用自动同步', exact: true }).isDisabled()) throw Error('automation gate missing');
                page.once('dialog', d => d.accept());
                await caldav.getByRole('button', { name: '确认同步', exact: true }).click();
                await caldav.getByText('本批次已写入 CalDAV，请在手机刷新后检查。', { exact: true }).waitFor();
                await caldav.getByRole('checkbox').check();
                await caldav.getByRole('button', { name: '启用自动同步', exact: true }).click();
                await caldav.getByText('自动同步已开启', { exact: true }).waitFor();
                await caldav.getByRole('button', { name: '暂停自动同步', exact: true }).click();
                await caldav.getByText('自动同步已暂停', { exact: true }).waitFor();
                caldavFailure = true;
                await caldav.getByRole('button', { name: '预览变更', exact: true }).click();
                await caldav.getByRole('alert').waitFor();
                await page.screenshot({ path: path.join(out, 'caldav-error-390.png') });
                caldavFailure = false;
            }
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
            await page.locator('#settings-caldav').scrollIntoViewIfNeeded();
            await page.locator('#settings-caldav').getByRole('button', { name: '预览变更', exact: true }).click();
            await page.locator('#settings-caldav').getByText('存在待处理项，尚未完成全量', { exact: true }).waitFor();
            await page.screenshot({ path: path.join(out, `caldav-${width}-dark.png`) });
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
        for (const width of [390, 430, 768, 1440]) {
            await page.setViewportSize({ width, height: width === 768 ? 1024 : width === 1440 ? 900 : width === 430 ? 932 : 844 });
            await page.goto(base + '/library/toc');
            const toc = page.locator('.library-toc');
            await toc.waitFor();
            const geometry = await page.evaluate(() => {
                const topbar = document.querySelector('.app-topbar')?.getBoundingClientRect();
                const toc = document.querySelector('.library-toc')?.getBoundingClientRect();
                return { topbarBottom: topbar?.bottom || 0, tocTop: toc?.top || 0, position: toc ? getComputedStyle(document.querySelector('.library-toc')).position : '' };
            });
            if (width <= 1100 && (Math.abs(geometry.tocTop - geometry.topbarBottom) > 2 || geometry.position !== 'sticky'))
                throw Error(`mobile toc is not attached to topbar at ${width}: ${JSON.stringify(geometry)}`);
            const manualScroll = await page.evaluate(() => {
                const root = document.querySelector('.library-detail-page');
                if (!root) return { before: -1, after: -1 };
                const before = root.scrollTop;
                root.scrollTo({ top: 100, behavior: 'auto' });
                const after = root.scrollTop;
                root.scrollTo({ top: before, behavior: 'auto' });
                return { before, after };
            });
            if (manualScroll.after <= 0) throw Error(`library detail scroll root is not writable at ${width}: ${JSON.stringify(manualScroll)}`);
            const targetButton = page.getByRole('button', { name: '第二章', exact: true });
            await targetButton.click();
            await page.waitForTimeout(800);
            const tocPosition = await page.evaluate(() => {
                const root = document.querySelector('.library-detail-page');
                const toc = document.querySelector('.library-toc');
                const button = Array.from(document.querySelectorAll('.library-toc-item')).find(item => item.textContent?.trim() === '第二章');
                const headingId = button?.getAttribute('data-toc-id');
                const heading = headingId ? Array.from(document.querySelectorAll('.library-markdown h1, .library-markdown h2, .library-markdown h3, .library-markdown h4, .library-markdown h5, .library-markdown h6')).find(item => item.id === headingId) : null;
                const rootRect = root?.getBoundingClientRect();
                const tocRect = toc?.getBoundingClientRect();
                const compact = (root?.clientWidth || 0) <= 1100;
                return { scrollTop: root?.scrollTop || 0, scrollHeight: root?.scrollHeight || 0, clientHeight: root?.clientHeight || 0, headingId, buttonId: button?.getAttribute('data-toc-id'), headingTop: heading?.getBoundingClientRect().top || 0, visibleTop: compact ? (tocRect?.bottom || 0) : (rootRect?.top || 0) };
            });
            if (tocPosition.scrollTop <= 0 || tocPosition.headingTop < tocPosition.visibleTop - 2)
                throw Error(`toc target did not scroll into view at ${width}: ${JSON.stringify(tocPosition)}`);
            await page.goto(base + '/library/toc');
            await page.locator('.library-internal-link').click();
            await page.getByText('跳转目标', { exact: true }).waitFor();
            if (new URL(page.url()).pathname !== '/library/target') throw Error(`markdown link navigation failed at ${width}`);
            await page.goBack();
            await page.getByRole('heading', { name: '目录验收文章', exact: true, level: 1 }).waitFor();
            await page.locator('.library-relation-target').click();
            await page.getByText('跳转目标', { exact: true }).waitFor();
            if (new URL(page.url()).pathname !== '/library/target') throw Error(`relation link navigation failed at ${width}`);
            checks.push({ width, libraryToc: true, markdownNavigation: true, relationNavigation: true, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
            await page.goBack();
            await page.getByRole('heading', { name: '目录验收文章', exact: true, level: 1 }).waitFor();
        }
        await page.goto(base + '/assistant');
        const aiInput = page.getByRole('textbox', { name: 'AI 助手输入框', exact: true });
        await aiInput.fill('请参考知识库');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.locator('.ai-knowledge-source').first().waitFor();
        await page.locator('.ai-knowledge-source').first().click();
        await page.getByText('跳转目标', { exact: true }).waitFor();
        if (new URL(page.url()).pathname !== '/library/target') throw Error('AI knowledge source navigation failed');
        checks.push({ aiKnowledgeSourceNavigation: true });
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
