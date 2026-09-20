// Built frontend, synthetic APIs and clipboard only; no personal data or real AI.
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('dist'), output = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-optimize-smoke-'));
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'text/html'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext(); const base = `http://127.0.0.1:${server.address().port}`;
  let note, mode = 'ok', count = 0, patches = 0; const inputs = [], errors = [], checks = [];
  await context.addInitScript(() => { localStorage.setItem('aicalendar_token', 'synthetic'); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { if (window.copyFails) throw Error('denied'); window.copiedText = t; } } }); });
  await context.route('**/api/**', async route => {
    const p = new URL(route.request().url()).pathname; let body = {};
    if (p === '/api/auth/me') body = { user: { id: 'synthetic', email: 'test@example.invalid', role: 'user' } };
    else if (p === '/api/note-items') body = { items: [note] };
    else if (p === '/api/ai/prompt-optimize') {
      inputs.push(route.request().postDataJSON().text); count++;
      if (mode === 'slow') await new Promise(r => setTimeout(r, 700));
      if (mode === 'fail') return route.fulfill({ status: 502, json: { error: '合成优化失败' } });
      body = { optimizedText: `检查并修复日历问题，保留现有行为。第${count}次` };
    } else if (p === '/api/note-items/note') {
      const data = route.request().postDataJSON(); patches++;
      if (mode === 'conflict') return route.fulfill({ status: 409, json: { error: '原文已变化，请重新打开最新记事后优化' } });
      assert.equal(data.expectedContent, note.content); note = { ...note, content: data.content }; body = { item: note };
    } else if (p === '/api/models') body = { models: [] };
    else if (p === '/api/schedule-model') body = { model: 'synthetic' };
    else if (p === '/api/ai-chat') throw Error('Optimizer must not call normal chat');
    else body = { items: [], messages: [], schedules: [], notifications: [] };
    return route.fulfill({ json: body });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  try {
    for (const [width, height] of [[390,844],[430,932],[768,1024],[1440,900]]) for (const theme of ['light','dark']) {
      note = { id: 'note', content: '修复日历问题，保留现有行为', color: 'purple', completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), linkedScheduleIds: [] };
      mode = 'ok'; await page.setViewportSize({ width, height });
      await page.goto(base + '/assistant'); await page.evaluate(t => localStorage.setItem('theme', t), theme); await page.reload();
      const opener = page.getByRole('button', { name: '优化提示词：' + note.content, exact: true });
      const toggle = page.getByRole('button', { name: '打开 AI 记事板', exact: true });
      await toggle.waitFor();
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await opener.click(); const dialog = page.getByRole('dialog');
      await dialog.locator('[aria-live="polite"]').filter({ hasText: /第\d+次/ }).waitFor(); const original = note.content;
      await dialog.getByRole('button', { name: '复制', exact: true }).click(); await dialog.getByText('已复制', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: '重新优化', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.textContent.includes('正在重新优化'));
      assert.equal(inputs.at(-1), original);
      await page.screenshot({ path: path.join(output, `${width}-${theme}.png`) });
      const box = await dialog.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1);
      await dialog.getByRole('button', { name: '取消', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.equal(note.content, original);
      await opener.click(); await dialog.locator('[aria-live="polite"]').filter({ hasText: /第\d+次/ }).waitFor();
      await dialog.getByRole('button', { name: '替换原文', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); assert.notEqual(note.content, original);
      checks.push(`${width} ${theme} preview regenerate copy cancel replace`);
    }
    const opener = page.getByRole('button', { name: /^优化提示词：/ });
    await opener.click(); const dialog = page.getByRole('dialog'); await dialog.locator('[aria-live="polite"]').filter({ hasText: /第\d+次/ }).waitFor();
    mode = 'fail'; await dialog.getByRole('button', { name: '重新优化', exact: true }).click(); await dialog.getByRole('alert').waitFor(); assert(await dialog.locator('[aria-live="polite"]').filter({ hasText: /第\d+次/ }).isVisible());
    mode = 'conflict'; await dialog.getByRole('button', { name: '替换原文', exact: true }).click(); await dialog.getByText(/原文已变化/).waitFor();
    await page.evaluate(() => window.copyFails = true); await dialog.getByRole('button', { name: '复制', exact: true }).click(); await dialog.getByText(/复制失败/).waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    mode = 'slow'; const before = patches; await opener.click(); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await page.waitForTimeout(900); assert.equal(patches, before); assert.equal(await page.getByRole('dialog').count(), 0);
    checks.push('failure retains result, conflict, clipboard error, Escape, late response ignored');
    assert.deepEqual(errors, []); console.log(JSON.stringify({ output, checks, errors }));
  } catch (e) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: path.join(output, 'failure.png') }); console.log(output); throw e; } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
