import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import express from 'express';
import cron from 'node-cron';
import { createApp, registerSpaFallback } from './app.js';
import { createRuntime, startRuntime } from './runtime/bootstrap.js';
import { createJobRunner, type ScheduleJob } from './runtime/job-runner.js';

test('factory import and construction do not read dotenv, create data, schedule jobs or listen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-factory-import-'));
  try {
    fs.writeFileSync(path.join(root, '.env'), 'PHASE4_IMPORT_SENTINEL=loaded\n');
    const script = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      const before = JSON.stringify(process.env);
      const { createApp } = await import(${JSON.stringify(new URL('./app.ts', import.meta.url).href)});
      await import(${JSON.stringify(new URL('./runtime/bootstrap.ts', import.meta.url).href)});
      createApp({ isProduction: false, isReady: () => true });
      assert.equal(JSON.stringify(process.env), before);
      assert.equal(fs.existsSync(process.env.DATA_DIR), false);
    `;
    const result = spawnSync(process.execPath, ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href, '--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, DATA_DIR: path.join(root, 'data'), BACKGROUND_JOBS_ENABLED: 'true' },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('entry import outside NODE_ENV=test never starts a listener or cron tasks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-entry-import-'));
  try {
    const script = `
      import assert from 'node:assert/strict';
      const cron = (await import(${JSON.stringify(new URL('../node_modules/node-cron/dist/esm/node-cron.js', import.meta.url).href)})).default;
      await import(${JSON.stringify(new URL('./index.ts', import.meta.url).href)});
      assert.equal(cron.getTasks().size, 0);
      const { backgroundJobs } = await import(${JSON.stringify(new URL('./application.ts', import.meta.url).href)});
      backgroundJobs.start(); backgroundJobs.start();
      assert.equal(cron.getTasks().size, 5);
      await backgroundJobs.stop();
      assert.equal(cron.getTasks().size, 0);
    `;
    const result = spawnSync(process.execPath, ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href, '--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, DATA_DIR: path.join(root, 'data'), NODE_ENV: 'development', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'true' },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('explicit CLI entry loads synthetic config before services and serves the production HTTP API', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-cli-smoke-'));
  try {
    fs.writeFileSync(path.join(root, '.env'), 'SMTP_HOST=fixture.example.invalid\n');
    const script = `
      import assert from 'node:assert/strict';
      import { fileURLToPath } from 'node:url';
      const entry = ${JSON.stringify(new URL('./index.ts', import.meta.url).href)};
      process.argv[1] = fileURLToPath(entry);
      await import(entry);
      const application = await import(${JSON.stringify(new URL('./application.ts', import.meta.url).href)});
      const { startRuntime } = await import(${JSON.stringify(new URL('./runtime/bootstrap.ts', import.meta.url).href)});
      const runtime = await startRuntime(application);
      try {
        const listener = await runtime.start();
        const base = 'http://127.0.0.1:' + listener.address().port;
        assert.equal((await fetch(base + '/api/health')).status, 200);
        assert.equal((await fetch(base + '/api/note-items')).status, 401);
        const { getEmailConfigurationSummary } = await import(${JSON.stringify(new URL('./email-service.ts', import.meta.url).href)});
        assert.equal(getEmailConfigurationSummary().host, 'fixture.example.invalid');
      } finally { await runtime.stop(); }
    `;
    const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: path.join(root, 'data'), APP_ENV: 'production', NODE_ENV: 'production',
      BACKGROUND_JOBS_ENABLED: 'false', JWT_SECRET: 'synthetic-phase4-production-secret-long-enough', APP_URL: 'https://fixture.example.invalid', PORT: '0',
      ADMIN_INVITE_CODE: 'synthetic-phase4-admin-invite', USER_INVITE_CODE: 'synthetic-phase4-user-invite' };
    delete env.SMTP_HOST;
    const result = spawnSync(process.execPath, ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href, '--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 15000, env,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('app preserves parser exceptions, readiness, OAuth/MCP and static fallback order', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicalendar-app-fixture-'));
  fs.writeFileSync(path.join(root, 'index.html'), 'synthetic SPA');
  let ready = false;
  const oauth = express.Router();
  oauth.get('/oauth/fixture', (_req, res) => res.json({ oauth: true }));
  const app = createApp({ isProduction: true, isReady: () => ready, oauthRouter: oauth,
    mcpRouter: (_req, res) => res.json({ mcp: true }), media: { route: '/media', root }, staticPath: root,
    registerRoutes(app) { app.all('/api/*', (req, res) => res.json({ length: req.body?.text?.length || 0 })); },
  });
  registerSpaFallback(app, root);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => listener.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (listener.address() as { port: number }).port;
  try {
    assert.equal((await fetch(base + '/oauth/fixture')).status, 200);
    assert.equal((await fetch(base + '/mcp')).status, 200);
    assert.equal((await fetch(base + '/api/health')).status, 503);
    ready = true;
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.equal((await fetch(base + '/media/missing')).status, 404);
    assert.equal(await (await fetch(base + '/schedule')).text(), 'synthetic SPA');
    const body = JSON.stringify({ text: 'x'.repeat(1024 * 1024 + 1) });
    const send = (url: string, method = 'POST') => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body });
    assert.equal((await send('/api/note-items')).status, 413);
    assert.equal((await send('/api/ai/imports/parse')).status, 200);
    assert.equal((await send('/api/completions/fixture/attachments')).status, 200);
    assert.equal((await send('/api/ai/imports/parse', 'PUT')).status, 413);
    assert.equal((await send('/api/completions/fixture/attachments/extra')).status, 413);
    assert.equal((await fetch(base + '/api/note-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
  } finally {
    await new Promise<void>(resolve => listener.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('job owner is idempotent, rejects new ticks during stop, and drains accepted work', async () => {
  const callbacks: (() => Promise<void>)[] = [];
  let stopped = 0, destroyed = 0, executed = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const schedule: ScheduleJob = (_job, run) => {
    callbacks.push(run);
    return { stop() { stopped++; }, destroy() { destroyed++; } };
  };
  const runner = createJobRunner(Array.from({ length: 5 }, (_, i) => ({ name: String(i), expression: '* * * * *', run: async () => { executed++; await pending; } })), () => {}, schedule);
  runner.start(); runner.start();
  assert.equal(callbacks.length, 5);
  const work = callbacks[0]();
  await Promise.resolve();
  let drained = false;
  const stopping = runner.stop().then(() => { drained = true; });
  await callbacks[1]();
  assert.equal(drained, false);
  assert.equal(executed, 1);
  assert.throws(() => runner.start(), /still stopping/);
  release(); await work; await stopping; await runner.stop();
  assert.equal(stopped, 5); assert.equal(destroyed, 5);
  runner.start(); assert.equal(callbacks.length, 10); await runner.stop();
});

test('real cron handles are destroyed and failed partial registration is cleaned up', async () => {
  const baseline = cron.getTasks().size;
  const runner = createJobRunner([{ name: 'fixture', expression: '* * * * *', run() {} }], () => {});
  runner.start(); assert.equal(cron.getTasks().size, baseline + 1);
  await runner.stop(); assert.equal(cron.getTasks().size, baseline);
  let destroyed = 0;
  const failed = createJobRunner([1, 2].map(i => ({ name: String(i), expression: '* * * * *', run() {} })), () => {}, job => {
    if (job.name === '2') throw new Error('injected schedule failure');
    return { stop() {}, destroy() { destroyed++; } };
  });
  assert.throws(() => failed.start(), /injected/); await failed.stop();
  assert.equal(destroyed, 1);
});

test('runtime starts once, owns its listener, and can stop during initialization', async () => {
  const app = createApp({ isProduction: false, isReady: () => true });
  let init = 0, started = 0, stopped = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const runtime = createRuntime({ app, runtimeConfig: { PORT: 0, backgroundJobsEnabled: true },
    initializeServer: async () => { init++; await pending; }, logServiceStarted() {},
    backgroundJobs: { start() { started++; }, async stop() { stopped++; } },
  });
  const first = runtime.start(), second = runtime.start();
  const stopping = runtime.stop(); release();
  const [a, b] = await Promise.all([first, second]); await stopping;
  assert.equal(a, b); assert.equal(a.listening, false);
  assert.equal(init, 1); assert.equal(started, 1); assert.equal(stopped, 1);
  const again = await runtime.start(); assert.equal(again.listening, true);
  await runtime.stop(); assert.equal(again.listening, false);
});

test('bootstrap owns signal handlers, disables jobs, and cleans up failed startup', async () => {
  const signals = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const baseline = signals();
  let jobStarts = 0;
  const deps = { app: createApp({ isProduction: false, isReady: () => true }),
    runtimeConfig: { PORT: 0, backgroundJobsEnabled: false }, initializeServer: async () => {},
    logServiceStarted() {}, backgroundJobs: { start() { jobStarts++; }, async stop() {} },
  };
  const runtime = await startRuntime(deps);
  try {
    assert.equal(await startRuntime(deps), runtime);
    assert.deepEqual(signals(), baseline.map(n => n + 1));
    assert.equal(jobStarts, 0);
  } finally { await runtime.stop(); }
  assert.deepEqual(signals(), baseline);
  const failed = { ...deps, app: createApp({ isProduction: false, isReady: () => true }),
    initializeServer: async () => { throw new Error('injected startup failure'); } };
  await assert.rejects(startRuntime(failed), /injected/);
  assert.deepEqual(signals(), baseline);
});

test('runtime reports occupied port and does not start workers', async () => {
  const app = createApp({ isProduction: false, isReady: () => true });
  const occupied = app.listen(0);
  await new Promise<void>(resolve => occupied.once('listening', resolve));
  let starts = 0;
  try {
    const runtime = createRuntime({ app, runtimeConfig: { PORT: (occupied.address() as { port: number }).port, backgroundJobsEnabled: true },
      initializeServer: async () => {}, logServiceStarted() {}, backgroundJobs: { start() { starts++; }, async stop() {} } });
    await assert.rejects(runtime.start(), { code: 'EADDRINUSE' });
    await runtime.stop(); assert.equal(starts, 0);
  } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
});
