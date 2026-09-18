import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { createAuth } from '../auth.js';
import { bridgeConfig, createCaldavBridge } from '../caldav-bridge.js';
import { CaldavError } from '../caldav-projection.js';
import { getAllSchedules, getCalendar } from '../schedule-store.js';

export function createCaldavRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const router = Router();
  let bridge: ReturnType<typeof createCaldavBridge> | undefined;
  // Deployment configuration is fixed for this process. No secrets in requests or responses.
  let config: ReturnType<typeof bridgeConfig> | undefined;
  router.use('/api/integrations/caldav', authenticate, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  for (const action of ['preview', 'sync'] as const) {
    router.post(`/api/integrations/caldav/${action}`, async (req, res) => {
      try {
        config ??= bridgeConfig();
        if (!config) return res.status(404).json({ error: 'CALDAV_BRIDGE_DISABLED' });
        if ((req as any).user?.userId !== config.userId) return res.status(403).json({ error: 'CALDAV_BRIDGE_FORBIDDEN' });
        const body = req.body || {};
        if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => action !== 'sync' || key !== 'planToken')
          || (action === 'sync' && (typeof body.planToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.planToken)))) {
          return res.status(400).json({ error: 'INVALID_BRIDGE_REQUEST' });
        }
        if (process.env.MAINTENANCE_MODE === 'true') return res.status(503).json({ error: 'BRIDGE_MAINTENANCE_MODE' });
        const bound = config;
        bridge ??= createCaldavBridge(bound,
          path.join(process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data'), 'caldav-bridge', 'state.json'),
          () => ({ complete: true,
            // getAllCalendars initializes defaults; use ownership-checked pure reads instead.
            calendars: bound.calendarIds.filter(id => !!getCalendar(id, bound.userId)),
            schedules: getAllSchedules(bound.userId),
          }));
        const result = action === 'preview' ? await bridge.preview() : await bridge.sync(body.planToken);
        return res.json({ mode: 'manual-pilot', writeEnabled: bound.writeEnabled, ...result });
      } catch (error) {
        // Never log fetch errors, upstream payloads, config or Basic credentials.
        return res.status(error instanceof CaldavError ? error.status : 503).json({ error: error instanceof CaldavError ? error.code : 'CALDAV_BRIDGE_FAILED' });
      }
    });
  }
  return router;
}
