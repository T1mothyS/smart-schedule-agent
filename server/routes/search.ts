import { Router, type RequestHandler } from 'express';
import { SEARCH_SCOPES, searchAll } from '../search-service.js';
import { addLog } from '../log-service.js';

export function createSearchRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();
  app.get('/api/search', authenticate, (req, res) => {
    const query = String(req.query.q || '').trim();
    const scope = String(req.query.scope || 'all');
    if (scope !== 'all' && !SEARCH_SCOPES.includes(scope as typeof SEARCH_SCOPES[number])) {
      return res.status(400).json({ error: '搜索范围不正确' });
    }
    try {
      return res.json(searchAll((req as any).user.userId, {
        query,
        scope,
        limit: req.query.limit,
      }));
    } catch (error) {
      addLog('error', 'system', '统一搜索失败', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: '搜索暂时不可用' });
    }
  });


  return app;
}
