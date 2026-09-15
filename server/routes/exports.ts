import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { getLocalDateString } from '../local-date.js';
import { createReadableUserExport, createSchedulesCsv } from '../export-service.js';

export function createExportsRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.get('/api/exports/user-data.json', authenticate, (req, res) => {
    try {
      const exported = createReadableUserExport((req as any).user.userId);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ai-calendar-data-${getLocalDateString()}.json"`);
      res.send(JSON.stringify(exported, null, 2));
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '导出 JSON 失败' });
    }
  });

  app.get('/api/exports/schedules.csv', authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ai-calendar-schedules-${getLocalDateString()}.csv"`);
      res.send(createSchedulesCsv((req as any).user.userId));
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '导出 CSV 失败' });
    }
  });

  // ============= 每日日报只读集成 =============
  return app;
}
