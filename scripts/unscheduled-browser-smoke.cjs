// Synthetic browser acceptance only; never contacts a live backend.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unscheduled-browser-'));
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  let file = path.resolve('dist', '.' + pathname);
  if (!file.startsWith(path.resolve('dist') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.resolve('dist/index.html');
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  try {
    for (const [width, height] of [[390,844], [430,932], [768,1024], [1440,900]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript(() => localStorage.setItem('aicalendar_token', 'synthetic-only'));
      let fail = false;
      const rows = [false, true].map((done, i) => ({ id: 'test-' + i, title: i ? '已完成合成待办' : '长标题中文与Emoji📅'.repeat(15), type: 'todo', calendar_id: 'personal', start_time: '2020-01-01T09:00:00', all_day: false, is_unscheduled: true, is_completed: done, category: 'other', priority: 'medium', notes: '检索备注', is_repeated: false, reminders: [], created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' }));
      await context.route('**/*', async route => {
        const u = new URL(route.request().url()); if (u.origin !== base) return route.abort();
        if (!u.pathname.startsWith('/api/')) return route.continue();
        let body = { schedules: [], tasks: [], notifications: [], items: [], reports: [], messages: [], users: [] };
        if (u.pathname === '/api/auth/me') body = { user: { id: 'synthetic', email: 'test@example.invalid', role: 'user' } };
        if (u.pathname === '/api/schedules/unscheduled') {
          await new Promise(r => setTimeout(r, 150));
          if (fail) return route.fulfill({ status: 503, json: { error: '合成加载错误' } });
          body = { schedules: rows.filter(r => r.is_unscheduled) };
        }
        if (u.pathname.endsWith('/toggle')) { const row = rows.find(r => u.pathname.includes(r.id)); row.is_completed = !row.is_completed; body = { schedule: row }; }
        if (route.request().method() === 'PUT') { const row = rows.find(r => u.pathname.endsWith(r.id)); Object.assign(row, route.request().postDataJSON()); body = { schedule: row }; }
        if (u.pathname === '/api/history') body = { completions: [{ id: 'proof', completedAt: '2020-01-01', reopenedAt: null, note: '合成记录' }] };
        await route.fulfill({ json: body });
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/today');
      const trigger = page.getByRole('button', { name: '查看全部挂起待办' });
      await trigger.click(); const drawer = page.getByRole('dialog');
      await drawer.getByText('已完成合成待办', { exact: true }).waitFor();
      const bounds = await drawer.boundingBox();
      assert(Math.abs(bounds.x + bounds.width / 2 - width / 2) < 2, 'dialog horizontally centered');
      assert(Math.abs(bounds.y + bounds.height / 2 - height / 2) < 2, 'dialog vertically centered');
      await page.mouse.click(3, height / 2);
      await drawer.waitFor({ state: 'detached' });
      assert(await trigger.evaluate(el => el === document.activeElement));
      await trigger.click();
      await drawer.getByText('已完成合成待办', { exact: true }).waitFor();
      await drawer.getByRole('button', { name: '设为未完成', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('option[value="pending"]')?.textContent === '未完成（2）');
      await drawer.getByRole('button', { name: '标记完成', exact: true }).last().click();
      await drawer.getByRole('button', { name: '设为未完成', exact: true }).waitFor();
      await drawer.getByRole('button', { name: '详情', exact: true }).last().click();
      await drawer.getByText('2020-01-01：合成记录', { exact: true }).waitFor();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        assert.equal(await drawer.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: path.join(out, `${width}-${theme}.png`) });
      }
      await drawer.getByLabel('搜索', { exact: true }).fill('不存在'); await drawer.getByText('没有符合条件的待办').waitFor();
      await drawer.getByLabel('搜索', { exact: true }).fill('');
      await drawer.getByRole('button', { name: '编辑', exact: true }).last().click();
      await drawer.locator('input[type=checkbox]').first().uncheck();
      await drawer.getByText('选择日期', { exact: true }).waitFor();
      page.once('dialog', dialog => dialog.accept());
      await drawer.getByRole('button', { name: '取消', exact: true }).click();
      await drawer.getByLabel('状态', { exact: true }).selectOption('completed');
      assert.equal(await drawer.locator('article').count(), 1);
      await drawer.getByLabel('状态', { exact: true }).selectOption('all');
      await page.keyboard.press('Escape'); await drawer.waitFor({ state: 'detached' }); assert(await trigger.evaluate(el => el === document.activeElement));
      fail = true; await trigger.click(); await page.getByRole('alert').waitFor();
      await page.screenshot({ path: path.join(out, `${width}-error.png`) });
      fail = false; await page.getByRole('button', { name: '重新加载' }).click(); await page.getByText('已完成合成待办', { exact: true }).waitFor();
      await context.close();
    }
    assert.deepEqual(errors, []); console.log('PASS: four viewports, light/dark, history, toggle, edit, empty/error, Escape/focus. Evidence:', out);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
