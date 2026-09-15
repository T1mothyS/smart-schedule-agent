import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { deleteUserMailAccount, getUserMailAccountStatus, readUserMail, saveUserMailAccount } from '../user-mail-service.js';
import { addLog } from '../log-service.js';

export function createMailAccountRouter({ authenticate }: Pick<ReturnType<typeof createAuth>, 'authenticate'>) {
  const app = Router();
  app.get('/api/user-mail-account', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ account: getUserMailAccountStatus((req as any).user.userId) });
  });

  app.put('/api/user-mail-account', authenticate, (req, res) => {
    const allowed = new Set(['username', 'authCode', 'enabled']);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !allowed.has(key))) {
      return res.status(400).json({ error: '请求正文只允许包含 username、authCode、enabled 字段' });
    }
    try {
      const userId = (req as any).user.userId;
      const account = saveUserMailAccount(userId, req.body);
      addLog('info', 'mail', '用户 QQ 邮箱配置已保存', {
        event: 'user_mail_account_saved',
        userId,
        enabled: account.enabled,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ account });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存 QQ 邮箱配置失败' });
    }
  });

  app.delete('/api/user-mail-account', authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const account = deleteUserMailAccount(userId);
    addLog('info', 'mail', '用户 QQ 邮箱配置已删除', {
      event: 'user_mail_account_deleted',
      userId,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ account });
  });

  app.post('/api/user-mail-account/test', authenticate, async (req, res) => {
    const userId = (req as any).user.userId;
    const result = await readUserMail(userId, 1);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ result });
  });

  // 日报云端 Context 由账号登录态维护；MCP 只读，避免模型自行改写长期偏好。
  return app;
}
