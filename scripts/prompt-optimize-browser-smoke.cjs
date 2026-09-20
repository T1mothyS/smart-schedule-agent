// Built frontend, synthetic APIs and clipboard only; no personal data or real AI.
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve('dist');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-optimize-smoke-'));
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
  if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'text/html');
  res.end(fs.readFileSync(file));
});

function now() { return new Date().toISOString(); }

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  const base = `http://127.0.0.1:${server.address().port}`;
  let note;
  let mode = 'ok';
  let optimizeRequests = 0;
  let patches = 0;
  const inputs = [];
  const errors = [];
  const checks = [];

  await context.addInitScript(() => {
    localStorage.setItem('aicalendar_token', 'synthetic');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async text => { window.copiedText = text; } },
    });
  });

  await context.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let body = {};

    if (pathname === '/api/auth/me') {
      body = { user: { id: 'synthetic', email: 'test@example.invalid', role: 'user' } };
    } else if (pathname === '/api/note-items' && request.method() === 'GET') {
      body = { items: [note] };
    } else if (pathname === '/api/note-items/note/optimize') {
      const data = request.postDataJSON();
      assert.equal(data.expectedContent, note.content);
      assert.equal(data.expectedRevision, note.contentRevision);
      inputs.push(data.expectedContent);
      optimizeRequests++;
      const original = note;
      if (mode === 'slow-conflict') {
        await new Promise(resolve => setTimeout(resolve, 100));
        note = { ...note, content: '外部已保存的新正文', contentRevision: note.contentRevision + 1, updatedAt: now() };
        await new Promise(resolve => setTimeout(resolve, 600));
        return route.fulfill({ status: 409, json: { error: '原文已变化，请重新打开最新记事后优化' } });
      }
      if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
      if (mode === 'fail') return route.fulfill({ status: 502, json: { error: '合成优化失败' } });
      note = {
        ...original,
        content: `检查并修复日历问题，保留现有行为。第${original.optimizationCount + 1}次`,
        isOptimized: true,
        optimizationCount: original.optimizationCount + 1,
        contentRevision: original.contentRevision + 1,
        updatedAt: now(),
      };
      return route.fulfill({ json: { item: note } });
    } else if (pathname === '/api/note-items/note/revert-optimization') {
      const data = request.postDataJSON();
      assert.equal(data.expectedContent, note.content);
      assert.equal(data.expectedRevision, note.contentRevision);
      if (!note.isOptimized) return route.fulfill({ status: 409, json: { error: '这条记事当前没有可撤回的优化结果。' } });
      note = {
        ...note,
        content: inputs.at(-1),
        isOptimized: false,
        contentRevision: note.contentRevision + 1,
        updatedAt: now(),
      };
      return route.fulfill({ json: { item: note } });
    } else if (pathname === '/api/note-items/note' && request.method() === 'PATCH') {
      const data = request.postDataJSON();
      patches++;
      if (mode === 'conflict') return route.fulfill({ status: 409, json: { error: '原文已变化，请重新打开最新记事后优化' } });
      if (data.content !== undefined) {
        assert.equal(data.expectedContent, note.content);
        assert.equal(data.expectedRevision, note.contentRevision);
        note = {
          ...note,
          content: data.content,
          isOptimized: false,
          contentRevision: note.contentRevision + 1,
          updatedAt: now(),
        };
      } else if (data.color !== undefined) {
        note = { ...note, color: data.color, updatedAt: now() };
      } else if (data.completed !== undefined) {
        note = { ...note, completed: data.completed, updatedAt: now() };
      }
      body = { item: note };
    } else if (pathname === '/api/models') {
      body = { models: [] };
    } else if (pathname === '/api/schedule-model') {
      body = { model: 'synthetic' };
    } else if (pathname === '/api/ai-chat') {
      throw new Error('Optimizer must not call normal chat');
    } else {
      body = { items: [], messages: [], schedules: [], notifications: [] };
    }
    return route.fulfill({ json: body });
  });

  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  async function openBoard() {
    const toggle = page.getByRole('button', { name: '打开 AI 记事板', exact: true });
    await toggle.waitFor();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }

  async function waitForEditor() {
    const editor = page.getByRole('textbox', { name: '编辑记事正文', exact: true });
    await editor.waitFor();
    return editor;
  }

  try {
    for (const [width, height] of [[390, 844], [430, 932], [768, 1024], [1440, 900]]) {
      for (const theme of ['light', 'dark']) {
        note = {
          id: 'note',
          content: '修复日历问题，保留现有行为',
          isOptimized: false,
          optimizationCount: 0,
          contentRevision: 0,
          color: 'purple',
          completed: false,
          completedAt: null,
          createdAt: now(),
          updatedAt: now(),
          linkedScheduleIds: [],
        };
        mode = 'slow';
        await page.setViewportSize({ width, height });
        await page.goto(base + '/assistant');
        await page.evaluate(value => localStorage.setItem('theme', value), theme);
        await page.reload();
        await openBoard();

        const original = note.content;
        const optimizeButton = page.getByRole('button', { name: `AI 优化：${original}`, exact: true });
        await optimizeButton.click();
        const editor = await waitForEditor();
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await editor.isDisabled(), true);
        await page.waitForFunction(() => {
          const element = document.querySelector('textarea[aria-label="编辑记事正文"]');
          return element && !element.disabled && element.value.includes('第1次');
        });
        assert.match(await editor.inputValue(), /第1次/);
        assert.match(await page.getByRole('button', { name: /^撤回第 1 次优化：/ }).getAttribute('aria-label'), /撤回第 1 次优化/);
        await page.screenshot({ path: path.join(output, `${width}-${theme}.png`) });

        await page.reload();
        await openBoard();
        await page.getByRole('button', { name: /^撤回第 1 次优化：/ }).click();
        await page.waitForFunction(() => document.querySelector('textarea[aria-label="编辑记事正文"]')?.value === '修复日历问题，保留现有行为');
        assert.equal(note.isOptimized, false);
        assert.equal(note.optimizationCount, 1);

        await page.getByRole('button', { name: `AI 优化：${original}`, exact: true }).click();
        const secondEditor = await waitForEditor();
        await page.waitForFunction(() => {
          const element = document.querySelector('textarea[aria-label="编辑记事正文"]');
          return element && !element.disabled && element.value.includes('第2次');
        });
        assert.match(await secondEditor.inputValue(), /第2次/);
        await secondEditor.fill('手动建立新基线');
        assert.equal(await page.getByRole('button', { name: /^(AI 优化|撤回第)/ }).isDisabled(), true);
        await page.getByRole('button', { name: /^保存记事：/ }).click();
        await page.getByRole('button', { name: 'AI 优化：手动建立新基线', exact: true }).waitFor();
        assert.equal(note.isOptimized, false);
        assert.equal(note.optimizationCount, 2);
        checks.push(`${width} ${theme} inline lock overwrite persistent undo second run manual baseline`);
      }
    }

    const currentContent = note.content;
    mode = 'fail';
    await page.getByRole('button', { name: `AI 优化：${currentContent}`, exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '合成优化失败' }).waitFor();
    assert.equal(note.content, currentContent);
    assert.equal(await page.getByRole('dialog').count(), 0);

    mode = 'slow-conflict';
    await page.getByRole('button', { name: `AI 优化：${currentContent}`, exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '原文已变化' }).waitFor();
    assert.equal(note.content, '外部已保存的新正文');
    assert.equal(await page.getByRole('dialog').count(), 0);
    checks.push('failure and slow version conflict do not overwrite content');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ output, checks, inputs, optimizeRequests, patches, errors }));
  } catch (error) {
    console.log(await page.locator('body').innerText());
    await page.screenshot({ path: path.join(output, 'failure.png') });
    console.log(output);
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
