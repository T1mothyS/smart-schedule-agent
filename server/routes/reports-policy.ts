import { Router, type RequestHandler } from 'express';
import * as dailyReportCloudStore from '../daily-report-cloud-store.js';
import { getDailyReportDeliveryPolicy, normalizeDailyReportDeliverySources, setDailyReportDeliveryPolicy } from '../daily-report-delivery-policy.js';
import { addLog } from '../log-service.js';

export function createReportsPolicyRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();
  app.get('/api/daily-report/cloud-context', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ context: dailyReportCloudStore.getDailyReportCloudContext((req as any).user.userId) });
  });

  app.put('/api/daily-report/cloud-context', authenticate, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== 'context')) {
      return res.status(400).json({ error: '请求正文只允许包含 context 字段' });
    }
    try {
      const context = dailyReportCloudStore.replaceDailyReportCloudContext((req as any).user.userId, req.body.context);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ context });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存日报云端 Context 失败' });
    }
  });

  app.get('/api/daily-report/delivery-policy', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getDailyReportDeliveryPolicy((req as any).user.userId));
  });

  app.put('/api/daily-report/delivery-policy', authenticate, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== 'sources')) {
      return res.status(400).json({ error: '请求正文只允许包含 sources 字段' });
    }
    try {
      const sources = normalizeDailyReportDeliverySources(req.body.sources);
      const userId = (req as any).user.userId;
      const policy = setDailyReportDeliveryPolicy(userId, sources);
      addLog('info', 'daily-report', '日报来源接收设置已保存', {
        event: 'daily_report_delivery_policy_saved',
        userId,
        sources: policy.sources,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(policy);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存日报来源接收设置失败' });
    }
  });

  app.get('/api/daily-report/cloud-activity', authenticate, (req, res) => {
    try {
      const activity = dailyReportCloudStore.listDailyReportCloudActivity((req as any).user.userId, {
        fromDate: req.query.fromDate ? String(req.query.fromDate) : undefined,
        toDate: req.query.toDate ? String(req.query.toDate) : undefined,
        limit: req.query.limit === undefined ? 100 : Number(req.query.limit),
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ activity });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '读取日报云端活动证据失败' });
    }
  });

  app.post('/api/daily-report/cloud-activity', authenticate, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: '请求正文必须是对象' });
    }
    try {
      const activity = dailyReportCloudStore.createDailyReportCloudActivity((req as any).user.userId, req.body);
      res.status(201).setHeader('Cache-Control', 'no-store').json({ activity });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存日报云端活动证据失败' });
    }
  });


  return app;
}
