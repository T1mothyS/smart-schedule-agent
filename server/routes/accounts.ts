import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';
import { describeErrorData } from '../runtime/logging.js';
import { v4 as uuidv4 } from 'uuid';
import * as dbModule from '../db.js';
import bcrypt from 'bcryptjs';
import { generateCode, sendVerificationEmail, summarizeEmailSendResult } from '../email-service.js';
import { addLog } from '../log-service.js';
import { getInviteCodeRole } from '../invite-code-service.js';
import * as db from '../db.js';

export function createAccountsRouter({ authenticate, signUserToken, setPageSessionCookie, setPageSessionFromBearer, clearPageSessionCookie }: Pick<ReturnType<typeof createAuth>, 'authenticate' | 'signUserToken' | 'setPageSessionCookie' | 'setPageSessionFromBearer' | 'clearPageSessionCookie'>) {
  const app = Router();
  app.post("/api/auth/send-register-code", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const invite_code = String(req.body?.invite_code || '');
      if (!email || !password || !invite_code) {
        return res.status(400).json({ error: '请填写邮箱、密码和邀请码' });
      }
      if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位' });
      // 验证邀请码
      const role = getInviteCodeRole(invite_code);
      if (!role) {
        return res.status(400).json({ error: '邀请码无效，请联系管理员获取有效邀请码' });
      }
      // 检查邮箱是否已注册
      const existing = db.getUserByEmail(email);
      if (existing) {
        return res.status(400).json({ error: '该邮箱已被注册' });
      }
      // 生成验证码
      const code = generateCode();
      const codeRecord: dbModule.DbEmailCode = {
        id: uuidv4(),
        email,
        code,
        purpose: 'register',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10分钟
        created_at: new Date().toISOString()
      };
      db.createEmailCode(codeRecord);
      // 发送邮件
      const sendResult = await sendVerificationEmail(email, code, 'register');
      addLog('info', 'mail', `注册验证码已发送至 ${email}，权限: ${role}`, {
        event: 'verification_email_sent',
        email,
        purpose: 'register',
        role,
        ...summarizeEmailSendResult(sendResult),
      });
      res.json({ success: true, message: '验证码已发送到您的邮箱' });
    } catch (error: any) {
      addLog('error', 'mail', '发送验证码失败', describeErrorData(error, {
        event: 'verification_email_failed',
      }));
      console.error('[Send Register Code] Error:', error);
      res.status(500).json({ error: '发送验证码失败: ' + (error?.message || '未知错误') });
    }
  });

  // 完成注册
  app.post("/api/auth/register", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const code = String(req.body?.code || '').trim();
      const invite_code = String(req.body?.invite_code || '');
      if (!email || !password || !code) {
        return res.status(400).json({ error: '请填写完整信息' });
      }
      if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位' });
      // 验证邀请码
      const role = getInviteCodeRole(invite_code);
      if (!role) {
        return res.status(400).json({ error: '邀请码无效' });
      }
      // 验证邮箱验证码
      const validCode = db.verifyEmailCode(email, code, 'register');
      if (!validCode) {
        return res.status(400).json({ error: '验证码无效或已过期，请重新获取' });
      }
      // 哈希密码
      const password_hash = await bcrypt.hash(password, 10);
      const userId = uuidv4();
      const now = new Date().toISOString();
      const user = db.createUser({
        id: userId,
        email,
        password_hash,
        role,
        disabled: 0,
        auth_version: 0,
        created_at: now,
        updated_at: now
      });
      // 删除已用验证码
      db.deleteEmailCode(email, 'register');
      // 创建该用户的提醒设置（默认禁用）
      db.upsertReminder({
        id: uuidv4(),
        user_id: userId,
        enabled: 0,
        hour: 8,
        minute: 0,
        reminder_email: email,
        created_at: now,
        updated_at: now
      });
      // 生成 JWT
      const token = signUserToken(user);
      addLog('info', 'auth', `新用户注册: ${email}，权限: ${role}`, { userId, role });
      setPageSessionCookie(res, token);
      res.json({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error: any) {
      addLog('error', 'auth', `注册失败: ${error.message}`);
      console.error('[Register] Error:', error);
      res.status(500).json({ error: '注册失败: ' + (error?.message || '未知错误') });
    }
  });

  // 登录
  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) {
        return res.status(400).json({ error: '请填写邮箱和密码' });
      }
      const user = db.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      if (user.disabled) {
        return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      const token = signUserToken(user);

      // 更新最后登录时间
      db.updateUserLastLogin(user.id);

      addLog('info', 'auth', `用户登录: ${email}`, { userId: user.id, role: user.role });
      setPageSessionCookie(res, token);
      res.json({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error: any) {
      addLog('error', 'auth', `登录失败: ${error.message}`);
      console.error('[Login] Error:', error);
      res.status(500).json({ error: '登录失败: ' + (error?.message || '未知错误') });
    }
  });

  // 获取当前用户信息
  app.get("/api/auth/me", authenticate, (req, res) => {
    const payload = (req as any).user as JwtPayload;
    const user = db.getUserById(payload.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });

    setPageSessionFromBearer(req, res);
    res.json({ user });
  });

  // 登出接口不要求当前 Bearer 有效，以便失效账号也能清理网页 Cookie。
  app.post("/api/auth/logout", (_req, res) => {
    clearPageSessionCookie(res);
    res.json({ success: true });
  });

  // 获取所有用户列表（管理员）- 支持分页和搜索
  return app;
}
