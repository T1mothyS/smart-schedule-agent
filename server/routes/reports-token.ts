import { Router, type RequestHandler } from 'express';
import { generateDailyReportToken, getDailyReportTokenStatus, revokeDailyReportToken } from '../daily-report-token-service.js';

export function createReportsTokenRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();
  app.get('/api/integrations/daily-report-token', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: getDailyReportTokenStatus((req as any).user.userId) });
  });

  app.post('/api/integrations/daily-report-token', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const generated = generateDailyReportToken((req as any).user.userId);
    res.json({
      token: generated.token,
      status: generated.status,
      warning: '令牌明文只显示这一次，请立即保存到日报项目的本地私密配置。',
    });
  });

  app.delete('/api/integrations/daily-report-token', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: revokeDailyReportToken((req as any).user.userId) });
  });


  return app;
}
