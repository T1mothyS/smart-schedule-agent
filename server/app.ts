import express from 'express';
import path from 'node:path';
import { createApiRateLimiter, securityHeaders } from './http-security.js';

export interface AppDependencies {
  isProduction: boolean;
  trustProxyHops?: number;
  isReady: () => boolean;
  oauthRouter?: express.RequestHandler;
  mcpRouter?: express.RequestHandler;
  media?: { route: string; root: string };
  staticPath?: string;
  registerRoutes?: (app: express.Express) => void;
}

// Importing this module does not load configuration, stores, workers or a listener.
export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (Number.isInteger(deps.trustProxyHops) && deps.trustProxyHops! > 0) app.set('trust proxy', deps.trustProxyHops);
  app.use(securityHeaders(deps.isProduction));
  app.use(createApiRateLimiter());
  const largeJsonParser = express.json({ limit: '75mb' });
  app.use((req, res, next) => {
    const acceptsLargeJson = req.method === 'POST' && (
      /^\/api\/completions\/[^/]+\/attachments$/.test(req.path)
      || req.path === '/api/ai/imports/parse'
    );
    if (acceptsLargeJson) return largeJsonParser(req, res, next);
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  if (deps.oauthRouter) app.use(deps.oauthRouter);
  if (deps.mcpRouter) app.use('/mcp', deps.mcpRouter);
  app.use('/api', (_req, res, next) => {
    if (!deps.isReady()) return res.status(503).json({ error: '数据库正在初始化，请稍后重试' });
    next();
  });
  if (deps.media) app.use(deps.media.route, express.static(deps.media.root, {
    dotfiles: 'deny', fallthrough: false, index: false, maxAge: '1y', immutable: true, redirect: false,
  }));
  if (deps.isProduction && deps.staticPath) app.use(express.static(deps.staticPath));
  deps.registerRoutes?.(app);
  return app;
}

// Must be installed after every API router, including the remaining legacy routes.
export function registerSpaFallback(app: express.Express, staticPath: string): void {
  app.get('*', (_req, res) => res.sendFile(path.join(staticPath, 'index.html')));
}
