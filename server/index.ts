import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment, startRuntime } from './runtime/bootstrap.js';

const isEntry = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntry) await loadEnvironment();
const application = await import('./application.js');
export const { app, initializeServer, signUserToken } = application;
if (isEntry) {
  try { await startRuntime(application); }
  catch (error) { console.error('[Startup] 服务器启动失败:', error); process.exitCode = 1; }
}
