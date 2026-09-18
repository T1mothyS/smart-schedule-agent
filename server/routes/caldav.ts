import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { CaldavError } from '../caldav-projection.js';
import { getCaldavService } from '../caldav-service.js';
import { withBridgeWork } from '../caldav-control.js';

export function createCaldavRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const router = Router();
  const base = '/api/integrations/caldav';
  router.use(base, authenticate, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  for (const action of ['status', 'preview', 'sync', 'automation'] as const) {
    router[action === 'status' ? 'get' : 'post'](`${base}/${action}`, async (req, res) => {
      try {
        const { service, config } = getCaldavService();
        if ((req as any).user?.userId !== config.userId) throw new CaldavError('CALDAV_BRIDGE_FORBIDDEN', 403);
        const body = req.body || {};
        const allowed = action === 'sync' ? ['planToken'] : action === 'automation' ? ['enabled', 'scopeVersion', 'phoneVerified'] : [];
        if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))
          || (action === 'sync' && (typeof body.planToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.planToken)))
          || (action === 'automation' && (typeof body.enabled !== 'boolean'
            || (body.scopeVersion !== undefined && (typeof body.scopeVersion !== 'string' || !/^[a-f0-9]{64}$/.test(body.scopeVersion)))
            || (body.phoneVerified !== undefined && typeof body.phoneVerified !== 'boolean')))) throw new CaldavError('INVALID_BRIDGE_REQUEST', 400);
        const result = action === 'status' ? service.status() : await withBridgeWork(async () => {
          if (action === 'preview') return service.preview();
          if (action === 'sync') return service.sync(body.planToken);
          return service.automation(body.enabled, body.scopeVersion, body.phoneVerified);
        });
        res.json({ mode: config.scope === 'all' ? 'full-one-way' : 'manual-pilot', writeEnabled: config.writeEnabled, ...result });
      } catch (error) {
        res.status(error instanceof CaldavError ? error.status : 503).json({ error: error instanceof CaldavError ? error.code : 'CALDAV_BRIDGE_FAILED' });
      }
    });
  }
  return router;
}
