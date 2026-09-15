import type { Express } from 'express';
import type { Server } from 'node:http';
import type { RuntimeConfig } from './config.js';

export async function loadEnvironment(): Promise<void> {
  const dotenv = await import('dotenv');
  dotenv.config();
}

interface RuntimeDependencies {
  app: Express;
  initializeServer: () => Promise<void>;
  runtimeConfig: Pick<RuntimeConfig, 'PORT' | 'backgroundJobsEnabled'>;
  backgroundJobs: { start(): void; stop(): Promise<void> };
  logServiceStarted: () => void;
}

export function createRuntime(deps: RuntimeDependencies) {
  let server: Server | undefined;
  let starting: Promise<Server> | undefined;
  let stopping: Promise<void> | undefined;
  const closeServer = async () => {
    const owned = server;
    server = undefined;
    if (owned?.listening) await new Promise<void>((resolve, reject) => {
      owned.close(error => error ? reject(error) : resolve());
      owned.closeIdleConnections();
    });
  };
  return {
    async start(): Promise<Server> {
      if (stopping) await stopping;
      if (starting) return starting;
      if (server?.listening) return server;
      starting = (async () => {
        await deps.initializeServer();
        try {
          server = await new Promise<Server>((resolve, reject) => {
            const listener = deps.app.listen(deps.runtimeConfig.PORT);
            listener.once('error', reject);
            listener.once('listening', () => {
              listener.off('error', reject);
              resolve(listener);
            });
          });
          if (deps.runtimeConfig.backgroundJobsEnabled) deps.backgroundJobs.start();
          deps.logServiceStarted();
          return server;
        } catch (error) {
          await Promise.allSettled([deps.backgroundJobs.stop(), closeServer()]);
          throw error;
        }
      })();
      try { return await starting; } finally { starting = undefined; }
    },
    async stop(): Promise<void> {
      if (stopping) return stopping;
      stopping = (async () => {
        // A signal arriving during initialization still closes the eventual listener.
        if (starting) await starting.catch(() => undefined);
        const results = await Promise.allSettled([deps.backgroundJobs.stop(), closeServer()]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      })();
      try { await stopping; } finally { stopping = undefined; }
    },
  };
}

// One owner per application, including repeated bootstrap calls.
const runtimes = new WeakMap<Express, ReturnType<typeof createRuntime>>();
export async function startRuntime(deps: RuntimeDependencies) {
  let runtime = runtimes.get(deps.app);
  if (!runtime) {
    runtime = createRuntime(deps);
    runtimes.set(deps.app, runtime);
    const shutdown = () => {
      void runtime!.stop().catch(error => {
        console.error('[Shutdown] 服务器关闭失败:', error);
        process.exitCode = 1;
      }).finally(() => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  const server = await runtime.start();
  console.log('[Startup] API 服务器已启动', server.address());
  return runtime;
}
