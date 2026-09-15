import { Router } from 'express';
import type { createAuth } from '../auth.js';
import { type JwtPayload } from '../auth.js';

import * as dbModule from '../db.js';
import jwt from 'jsonwebtoken';
import { normaliseCodeBuddyBaseUrl } from '../codebuddy-env.js';
import { addLog } from '../log-service.js';
import * as db from '../db.js';
import { defaultModel, modelService, getAvailableModels, resolveCodeBuddyCredentialInfo, resolveCodeBuddyCredential, getMissingCodeBuddyCredentialMessage } from '../ai-credentials.js';

export function createSettingsRouter({ authenticate, JWT_SECRET }: Pick<ReturnType<typeof createAuth>, 'authenticate'> & { JWT_SECRET: string }) {
  const app = Router();
  app.get("/api/schedule-model", authenticate, (req, res) => {
    const userId = ((req as any).user as JwtPayload).userId;
    res.json({ model: db.getUserPreferredModel(userId, defaultModel) });
  });
  app.post("/api/schedule-model", authenticate, (req, res) => {
    const userId = ((req as any).user as JwtPayload).userId;
    const model = String(req.body?.model || '').trim();
    if (!model || model.length > 100) return res.status(400).json({ error: '模型名称无效' });
    if (!db.updateUserPreferredModel(userId, model)) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true, model });
  });

  interface LoginStatusResponse {
    isLoggedIn: boolean;
    hasApiKey?: boolean;
    error?: string;
    apiKey?: string; // 脱敏后的 API Key
    usingSharedApi?: boolean;
  }

  // 【修复】检查 API Key 状态
  // 【修复数据隔离】检查登录状态 - 获取当前用户的 API Key
  app.get("/api/check-login", authenticate, async (req, res) => {
    const response: LoginStatusResponse = {
      isLoggedIn: false,
    };

    // 从 JWT 获取当前用户 ID
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
        const resolvedCredential = resolveCodeBuddyCredentialInfo(payload.userId);
        const userKey = resolvedCredential?.credential;

        if (userKey?.api_key) {
          response.isLoggedIn = true;
          response.hasApiKey = true;
          if (resolvedCredential?.source === 'admin-shared') {
            // 共享凭据只在服务端使用，普通用户前端不能看到任何 Key 片段。
            response.usingSharedApi = true;
          } else {
            // 个人 Key 仍按原有方式脱敏显示。
            response.apiKey = userKey.api_key.slice(0, 8) + '****' + userKey.api_key.slice(-4);
          }
        } else {
          response.hasApiKey = false;
          response.error = getMissingCodeBuddyCredentialMessage(payload.userId);
        }
      } catch {
        response.error = '登录状态验证失败';
      }
    } else {
      response.error = '未登录';
    }

    res.json(response);
  });

  // 获取可用模型列表
  // 【修复数据隔离】获取模型列表 - 需要用户认证
  app.get("/api/models", authenticate, async (req, res) => {
    try {
      // authenticate 已完成 JWT 校验，直接读取当前用户的凭据，避免重复解析和生产日志泄露账号信息。
      const currentUser = (req as any).user as JwtPayload;
      const userCredential = resolveCodeBuddyCredential(currentUser.userId);

      if (!userCredential) {
        return res.status(401).json({
          error: getMissingCodeBuddyCredentialMessage(currentUser.userId),
        });
      }

      const models = await getAvailableModels(
        currentUser.userId,
        userCredential,
        req.query.refresh === '1',
      );

      res.json({
        models: models || [],
        defaultModel
      });
    } catch (error: any) {
      console.error("[Models] Error:", error);
      res.json({
        models: [],
        defaultModel,
        error: error?.message || String(error)
      });
    }
  });

  // ============= AI 日程对话历史 =============

  app.post("/api/verify-api-key", authenticate, async (req, res) => {
    try {
      // 【修复数据隔离】从数据库获取当前用户的 API Key
      let userCredential: dbModule.DbUserApiKey | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
          userCredential = resolveCodeBuddyCredential(payload.userId);
        } catch {}
      }

      if (!userCredential) {
        const currentUser = (req as any).user as JwtPayload;
        return res.status(401).json({
          valid: false,
          error: getMissingCodeBuddyCredentialMessage(currentUser.userId),
          code: 'NO_KEY'
        });
      }

      // 验证必须绕过缓存，确保当前凭据仍然有效。
      const currentUser = (req as any).user as JwtPayload;
      const models = await getAvailableModels(currentUser.userId, userCredential, true);

      res.json({
        valid: true,
        modelCount: models.length,
        models: models.slice(0, 5).map((m: any) => m.modelId) // 返回前5个模型ID
      });
    } catch (error: any) {
      console.error("[Verify API Key] Error:", error);

      // 区分不同错误类型
      const errorMsg = error?.message || String(error);
      const errorCode = error?.code || '';

      // 429 额度用完
      if (errorMsg.includes('429') || errorMsg.includes('Credits exhausted') || errorCode === 'QUOTA_EXCEEDED') {
        return res.status(402).json({
          valid: true,  // Key 本身有效，只是额度用完
          keyValid: true,
          quotaExhausted: true,
          error: 'API Key 有效，但额度已用完。请前往 CodeBuddy 控制台购买额度。',
          code: 'QUOTA_EXHAUSTED',
          purchaseUrl: 'https://www.codebuddy.cn/profile/usage'
        });
      }

      // 无效 Key
      if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('Invalid API key') || errorMsg.includes('无效')) {
        return res.status(401).json({
          valid: false,
          keyValid: false,
          error: 'API Key 无效，请检查是否正确填写',
          code: 'INVALID_KEY'
        });
      }

      // 网络错误
      if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('ECONNREFUSED')) {
        return res.status(503).json({
          valid: false,
          error: '网络连接失败，请检查网络后重试',
          code: 'NETWORK_ERROR'
        });
      }

      // 其他错误
      return res.status(500).json({
        valid: false,
        error: errorMsg,
        code: 'UNKNOWN_ERROR'
      });
    }
  });

  // ============= 用户 API Key 管理 =============

  // 获取当前用户的 API Key
  app.get("/api/user-api-key", authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const payload = (req as any).user as JwtPayload;
      const userApiKey = db.getUserApiKey(payload.userId);

      if (userApiKey) {
        res.json({
          hasKey: true,
          maskedApiKey: userApiKey.api_key.slice(0, 8) + '****' + userApiKey.api_key.slice(-4),
          baseUrl: userApiKey.base_url || ''
        });
      } else {
        res.json({
          hasKey: false,
          apiKey: '',
          baseUrl: ''
        });
      }
    } catch (error: any) {
      console.error("[UserApiKey] Error:", error);
      res.status(500).json({ error: '获取 API Key 失败' });
    }
  });

  // 保存/更新用户的 API Key
  app.post("/api/user-api-key", authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const payload = (req as any).user as JwtPayload;
      const { apiKey, baseUrl } = req.body;

      if (!apiKey || !String(apiKey).trim()) {
        return res.status(400).json({ error: 'API Key 不能为空' });
      }
      const normalizedApiKey = String(apiKey).trim();
      if (normalizedApiKey.length > 4_096) return res.status(400).json({ error: 'API Key 过长' });
      const normalizedBaseUrl = normaliseCodeBuddyBaseUrl(baseUrl);

      const userApiKey: dbModule.DbUserApiKey = {
        id: `uak_${Date.now()}`,
        user_id: payload.userId,
        api_key: normalizedApiKey,
        base_url: normalizedBaseUrl,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      db.upsertUserApiKey(userApiKey);

      modelService.invalidate(payload.userId);

      addLog('info', 'system', '用户更新了 API Key', { userId: payload.userId });
      res.json({ success: true, message: 'API Key 保存成功' });
    } catch (error: any) {
      console.error("[UserApiKey] Error:", error);
      const message = error?.message || '保存 API Key 失败';
      res.status(String(message).startsWith('CodeBuddy Base URL') ? 400 : 500).json({ error: message });
    }
  });
  return app;
}
