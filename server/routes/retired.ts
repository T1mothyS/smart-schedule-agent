import { Router } from 'express';
import type { createAuth } from '../auth.js';

export function createRetiredRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.all(['/api/chat', '/api/permission-response'], authenticate, (_req, res) => {
    res.status(410).json({ error: '旧聊天接口已停用，请使用 /api/ai-chat' });
  });
  app.post('/api/ai-schedule', authenticate, (_req, res) => {
    res.status(410).json({ error: '旧自动写入接口已停用，请使用 /api/ai-chat 并确认计划' });
  });
  app.all('/api/reminders', authenticate, (_req, res) => {
    res.status(410).json({ error: '旧提醒设置接口已停用，请使用 /api/notification-preferences' });
  });

  // 登录状态响应类型
  return app;
}
