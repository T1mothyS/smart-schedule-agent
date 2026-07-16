import express from "express";
import { query, unstable_v2_createSession, unstable_v2_authenticate, PermissionResult, CanUseTool } from "@tencent-ai/agent-sdk";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import * as dbModule from "./db.js";
import * as scheduleStore from "./schedule-store.js";
import { initScheduleDb } from "./schedule-store.js";
import * as reminderStore from "./reminder-store.js";
import { initReminderDb } from "./reminder-store.js";
import * as reminderCalendarSync from "./reminder-calendar-sync.js";
import { toggleScheduleCompletion } from "./schedule-completion-service.js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cron from "node-cron";
import { generateCode, sendVerificationEmail, sendReminderTestEmail } from "./email-service.js";
import { processCycleReminders } from "./reminder-service.js";
import * as activityStore from "./activity-store.js";
import { initActivityDb } from "./activity-store.js";
import { getActionCenter } from "./action-center.js";
import * as attachmentService from "./attachment-service.js";
import { enqueueUserNotification, processNotificationQueue } from "./notification-service.js";
import * as backupService from "./backup-service.js";
import { parseAiImport, type AiImportDraft } from "./ai-import-service.js";
import { pollEmailImports } from "./email-import-service.js";
import { buildCodeBuddyEnv } from "./codebuddy-env.js";
import { createModelService } from "./model-service.js";

// 数据库实例（等待初始化后赋值）
let db: typeof dbModule;
let dbInitialized = false;

// 加载 .env 文件（如果存在）
dotenv.config();

// 【关键修复】获取本地时区的日期字符串（YYYY-MM-DD）
function getLocalDateString(date?: Date): string {
  const d = date || new Date();
  // 使用本地时区获取日期部分
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 获取本地时间的 ISO 字符串（带时区）
function getLocalISOString(date?: Date): string {
  const d = date || new Date();
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - offset * 60 * 1000);
  return localDate.toISOString();
}

// 【修复】默认使用国内版 API（codebuddy.cn）
// 国内用户需要设置 CODEBUDDY_INTERNET_ENVIRONMENT=internal
if (!process.env.CODEBUDDY_INTERNET_ENVIRONMENT) {
  process.env.CODEBUDDY_INTERNET_ENVIRONMENT = 'internal';
  console.log('[Startup] 使用国内版 API (CODEBUDDY_INTERNET_ENVIRONMENT=internal)');
}

const execAsync = promisify(exec);

// 待处理的权限请求
interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  userId: string;
  timestamp: number;
}

const pendingPermissions = new Map<string, PendingPermission>();

// 权限请求超时时间（5分钟）
const PERMISSION_TIMEOUT = 5 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
const staticPath = path.resolve(__dirname, '../dist');

// Middleware
app.use(express.json({ limit: '35mb' }));

// 【新增】数据库初始化检查中间件
app.use('/api', (req, res, next) => {
  if (!dbInitialized) {
    return res.status(503).json({ error: '数据库正在初始化，请稍后重试' });
  }
  next();
});

// 生产环境直接提供 Vite 构建产物；部署时只需先执行 npm run build。
if (isProduction) {
  app.use(express.static(staticPath));
  console.log(`[Static] Serving files from: ${staticPath}`);
}

// 【修复】默认模型改为用户支持的模型
const defaultModel = "glm-5.1";
const modelService = createModelService<any>({
  ttlMs: 30 * 60 * 1000,
  timeoutMs: 30 * 1000,
  onCloseError: error => console.error('[Models] 关闭 SDK Session 失败:', error),
});

function getAvailableModels(
  userId: string,
  credential: dbModule.DbUserApiKey,
  forceRefresh = false,
) {
  return modelService.load({
    userId,
    credentialVersion: credential.updated_at,
    forceRefresh,
    createSession: () => unstable_v2_createSession({
      cwd: process.cwd(),
      env: buildCodeBuddyEnv(credential),
    }),
  });
}

// ==================== 日志系统 ====================
// 内存日志缓冲区（最多保留500条）
const MAX_LOG_ENTRIES = 500;
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: 'schedule' | 'ai' | 'db' | 'system' | 'reminder' | 'auth' | 'admin';
  message: string;
  data?: any;
}
const logBuffer: LogEntry[] = [];

// 记录日志
function addLog(level: LogEntry['level'], category: LogEntry['category'], message: string, data?: any) {
  const now = new Date();
  // 使用本地时间：YYYY-MM-DD HH:MM:SS.mmm
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  const entry: LogEntry = {
    timestamp,
    level,
    category,
    message,
    data
  };
  logBuffer.push(entry);
  // 同时输出到控制台（方便服务端排查）
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${category}]`;
  if (level === 'error') console.error(prefix, message, data ?? '');
  else if (level === 'warn') console.warn(prefix, message, data ?? '');
  else console.log(prefix, message, data ?? '');
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
}

// 日志 API
app.get("/api/logs", authenticate, requireAdmin, (req, res) => {
  const { level, category, limit } = req.query;
  let filtered = [...logBuffer];
  
  if (level && level !== 'all') {
    filtered = filtered.filter(l => l.level === level);
  }
  if (category && category !== 'all') {
    filtered = filtered.filter(l => l.category === category);
  }
  
  const maxItems = limit ? parseInt(limit as string) : 100;
  filtered = filtered.slice(-maxItems);
  
  res.json({ 
    logs: filtered,
    total: logBuffer.length,
    max: MAX_LOG_ENTRIES
  });
});

app.delete("/api/logs", authenticate, requireAdmin, (req, res) => {
  logBuffer.length = 0;
  addLog('info', 'system', '日志已清空');
  res.json({ success: true });
});

// 导出日志为文本文件
app.get("/api/logs/export", authenticate, requireAdmin, (req, res) => {
  const { format = 'txt' } = req.query;
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const filename = `schedule-logs-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    res.json({ exportedAt: now.toISOString(), total: logBuffer.length, logs: logBuffer });
  } else {
    // 默认 txt 格式
    const lines = logBuffer.map(l => {
      const data = l.data ? `  ${JSON.stringify(l.data)}` : '';
      return `[${l.timestamp}] [${l.level.toUpperCase().padEnd(5)}] [${l.category.padEnd(8)}] ${l.message}${data}`;
    });
    const header = `智能日程表 - 调试日志导出\n导出时间: ${now.toLocaleString('zh-CN')}\n共 ${logBuffer.length} 条记录\n${'='.repeat(80)}\n\n`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
    res.send(header + lines.join('\n'));
  }
});

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 日程 AI 模型配置（读/写）
let scheduleModel = defaultModel;
app.get("/api/schedule-model", authenticate, (req, res) => {
  res.json({ model: scheduleModel });
});
app.post("/api/schedule-model", authenticate, (req, res) => {
  const { model } = req.body;
  if (model) { scheduleModel = model; }
  res.json({ success: true, model: scheduleModel });
});

// 登录状态响应类型
interface LoginStatusResponse {
  isLoggedIn: boolean;
  hasApiKey?: boolean;
  error?: string;
  apiKey?: string; // 脱敏后的 API Key
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
      const userKey = db.getUserApiKey(payload.userId);
      
      if (userKey?.api_key) {
        response.isLoggedIn = true;
        response.hasApiKey = true;
        // 脱敏显示
        response.apiKey = userKey.api_key.slice(0, 8) + '****' + userKey.api_key.slice(-4);
      } else {
        response.hasApiKey = false;
        response.error = '未配置 API Key，请在设置页输入您的 CodeBuddy API Key';
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
    const userCredential: dbModule.DbUserApiKey | undefined =
      db.getUserApiKey(currentUser.userId) || undefined;

    if (!userCredential) {
      return res.status(401).json({ 
        error: '请先在设置页输入 API Key',
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
app.get("/api/ai-schedule/history", authenticate, (req, res) => {
  try {
    const payload = (req as any).user as JwtPayload;
    const sessions = db.getAllSessions(payload.userId);
    // 获取所有消息（取最近的20条）
    let allMessages: any[] = [];
    
    for (const session of sessions) {
      const msgs = db.getMessagesBySession(session.id, payload.userId);
      allMessages.push(...msgs);
    }
    
    // 按时间排序，取最近20条
    allMessages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    allMessages = allMessages.slice(0, 20);
    
    res.json({ messages: allMessages });
  } catch (error: any) {
    console.error("[AI History] Error:", error);
    res.json({ messages: [] });
  }
});

// ============= API Key 验证接口 =============

// 验证当前用户 API Key 可用性（区分额度用完和无效 Key）
app.post("/api/verify-api-key", authenticate, async (req, res) => {
  try {
    // 【修复数据隔离】从数据库获取当前用户的 API Key
    let userCredential: dbModule.DbUserApiKey | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
        const userKey = db.getUserApiKey(payload.userId);
        userCredential = userKey || undefined;
      } catch {}
    }

    if (!userCredential) {
      return res.status(401).json({ 
        valid: false, 
        error: 'API Key 未配置，请在设置页输入',
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
    const payload = (req as any).user as JwtPayload;
    const userApiKey = db.getUserApiKey(payload.userId);
    
    if (userApiKey) {
      res.json({
        hasKey: true,
        apiKey: userApiKey.api_key,
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
    const payload = (req as any).user as JwtPayload;
    const { apiKey, baseUrl } = req.body;
    
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: 'API Key 不能为空' });
    }
    
    const userApiKey: dbModule.DbUserApiKey = {
      id: `uak_${Date.now()}`,
      user_id: payload.userId,
      api_key: apiKey.trim(),
      base_url: baseUrl?.trim() || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    db.upsertUserApiKey(userApiKey);
    
    modelService.invalidate(payload.userId);
    
    addLog('info', 'system', `用户 ${payload.email} 更新了 API Key`);
    res.json({ success: true, message: 'API Key 保存成功' });
  } catch (error: any) {
    console.error("[UserApiKey] Error:", error);
    res.status(500).json({ error: '保存 API Key 失败' });
  }
});

// ============= 会话 API =============

// 获取所有会话（包含消息数量）
app.get("/api/sessions", authenticate, (req, res) => {
  try {
    const userId = ((req as any).user as JwtPayload).userId;
    const sessions = db.getAllSessions(userId);
    const sessionsWithMessages = sessions.map(session => {
      const messages = db.getMessagesBySession(session.id, userId);
      return {
        ...session,
        messageCount: messages.length
      };
    });
    res.json({ sessions: sessionsWithMessages });
  } catch (error: any) {
    console.error("[Sessions] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 获取单个会话及其消息
app.get("/api/sessions/:sessionId", authenticate, (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = ((req as any).user as JwtPayload).userId;
    const session = db.getSession(sessionId, userId);
    
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    const messages = db.getMessagesBySession(sessionId, userId);
    
    // 解析 tool_calls JSON
    const parsedMessages = messages.map(msg => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null
    }));
    
    res.json({ session, messages: parsedMessages });
  } catch (error: any) {
    console.error("[Session] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 创建新会话
app.post("/api/sessions", authenticate, (req, res) => {
  try {
    const { model = defaultModel, title = "新对话" } = req.body;
    const userId = ((req as any).user as JwtPayload).userId;
    const now = new Date().toISOString();
    
    const session = db.createSession({
      id: uuidv4(),
      user_id: userId,
      title,
      model,
      sdk_session_id: null,
      created_at: now,
      updated_at: now
    });
    
    res.json({ session });
  } catch (error: any) {
    console.error("[Create Session] Error:", error);
    res.status(500).json({ error: error?.message || "创建会话失败" });
  }
});

// ============================================================
// 多用户认证系统
// ============================================================

// JWT 配置
function requiredProductionConfig(name: string, fallback: string): string {
  const value = process.env[name];
  if (isProduction && !value) {
    throw new Error('[Config] 生产环境缺少必需配置: ' + name);
  }
  return value || fallback;
}

const JWT_SECRET = requiredProductionConfig('JWT_SECRET', 'dev-only-jwt-secret');
const JWT_EXPIRES_IN = '7d';

// 固定邀请码
const ADMIN_INVITE_CODE = requiredProductionConfig('ADMIN_INVITE_CODE', 'dev-admin-invite');
const USER_INVITE_CODE = requiredProductionConfig('USER_INVITE_CODE', 'dev-user-invite');

// JWT payload 类型
interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
}

// 认证中间件
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    (req as any).user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token 无效或已过期，请重新登录' });
  }
}

// 管理员中间件
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((req as any).user?.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

// 发送注册验证码
app.post("/api/auth/send-register-code", async (req, res) => {
  try {
    const { email, password, invite_code } = req.body;
    if (!email || !password || !invite_code) {
      return res.status(400).json({ error: '请填写邮箱、密码和邀请码' });
    }
    // 验证邀请码
    let role: 'admin' | 'user' | null = null;
    if (invite_code === ADMIN_INVITE_CODE) role = 'admin';
    else if (invite_code === USER_INVITE_CODE) role = 'user';
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
    await sendVerificationEmail(email, code, 'register');
    addLog('info', 'auth', `注册验证码已发送至 ${email}，权限: ${role}`, { email, role });
    res.json({ success: true, message: '验证码已发送到您的邮箱' });
  } catch (error: any) {
    addLog('error', 'auth', `发送验证码失败: ${error.message}`);
    console.error('[Send Register Code] Error:', error);
    res.status(500).json({ error: '发送验证码失败: ' + (error?.message || '未知错误') });
  }
});

// 完成注册
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, code, invite_code } = req.body;
    if (!email || !password || !code) {
      return res.status(400).json({ error: '请填写完整信息' });
    }
    // 验证邀请码
    let role: 'admin' | 'user' | null = null;
    if (invite_code === ADMIN_INVITE_CODE) role = 'admin';
    else if (invite_code === USER_INVITE_CODE) role = 'user';
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
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    addLog('info', 'auth', `新用户注册: ${email}，权限: ${role}`, { userId, role });
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
    const { email, password } = req.body;
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
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    
    // 更新最后登录时间
    db.updateUserLastLogin(user.id);
    
    addLog('info', 'auth', `用户登录: ${email}`, { userId: user.id, role: user.role });
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
  
  res.json({ user });
});

// 获取所有用户列表（管理员）- 支持分页和搜索
app.get("/api/admin/users", authenticate, requireAdmin, (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || '';
  const result = db.getUsersPaginated(page, pageSize, search);
  res.json(result);
});

// 修改用户角色（管理员）
app.put("/api/admin/users/:id/role", authenticate, requireAdmin, (req, res) => {
  const { role } = req.body;
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: '角色必须是 admin 或 user' });
  }
  
  // 禁止降权管理员
  if (role === 'user') {
    const targetUser = db.getUserById(req.params.id);
    if (targetUser?.role === 'admin') {
      return res.status(403).json({ error: '无法降权管理员账号' });
    }
  }
  
  const success = db.updateUserRole(req.params.id, role);
  if (!success) return res.status(404).json({ error: '用户不存在' });
  addLog('info', 'admin', `修改用户角色: ${req.params.id} → ${role}`);
  res.json({ success: true });
});

// 禁用/启用用户（管理员）
app.put("/api/admin/users/:id/disabled", authenticate, requireAdmin, (req, res) => {
  const { disabled } = req.body;
  const success = db.updateUserDisabled(req.params.id, disabled ? 1 : 0);
  if (!success) return res.status(404).json({ error: '用户不存在' });
  addLog('info', 'admin', `${disabled ? '禁用' : '启用'}用户: ${req.params.id}`);
  res.json({ success: true });
});

// 删除用户及其所有数据（管理员）
app.delete("/api/admin/users/:id", authenticate, requireAdmin, (req, res) => {
  const targetUserId = req.params.id;
  
  // 禁止删除自己
  const payload = (req as any).user as JwtPayload;
  if (targetUserId === payload.userId) {
    return res.status(403).json({ error: '无法删除自己的账号' });
  }
  
  // 禁止删除管理员
  const targetUser = db.getUserById(targetUserId);
  if (targetUser?.role === 'admin') {
    return res.status(403).json({ error: '无法删除管理员账号' });
  }
  
  // 删除用户的日程
  const deletedSchedules = scheduleStore.deleteSchedulesByUser(targetUserId);
  const deletedReminderTasks = reminderStore.deleteReminderTasksByUser(targetUserId);
  
  // 删除用户及其关联数据
  const success = db.deleteUser(targetUserId);
  if (!success) return res.status(404).json({ error: '用户不存在' });
  
  addLog('info', 'admin', `删除用户: ${targetUserId}，删除了 ${deletedSchedules} 条日程和 ${deletedReminderTasks} 条周期提醒`);
  res.json({ success: true, deletedSchedules, deletedReminderTasks });
});

// 清空用户数据（保留账号）（管理员）
app.post("/api/admin/users/:id/clear-data", authenticate, requireAdmin, (req, res) => {
  const targetUserId = req.params.id;
  
  // 禁止清空自己的数据
  const payload = (req as any).user as JwtPayload;
  if (targetUserId === payload.userId) {
    return res.status(403).json({ error: '无法清空自己的数据' });
  }
  
  // 删除用户的日程
  const deletedSchedules = scheduleStore.deleteSchedulesByUser(targetUserId);
  const deletedReminderTasks = reminderStore.deleteReminderTasksByUser(targetUserId);
  
  // 清空用户其他数据（API Key、提醒设置等）
  const result = db.clearUserData(targetUserId);
  
  addLog('info', 'admin', `清空用户数据: ${targetUserId}，删除了 ${deletedSchedules} 条日程和 ${deletedReminderTasks} 条周期提醒`);
  res.json({ success: true, deletedSchedules, deletedReminderTasks, clearedSessions: result.sessions });
});

// 获取提醒设置
app.get("/api/reminders", authenticate, (req, res) => {
  const payload = (req as any).user as JwtPayload;
  const reminder = db.getReminder(payload.userId);
  res.json({
    reminder: {
      enabled: !!reminder?.enabled,
      hour: reminder?.hour ?? 8,
      minute: reminder?.minute ?? 0,
      reminderEmail: reminder?.reminder_email || payload.email,
    },
  });
});

// ============= 今日行动中心 / 完成记录 / 通知中心 =============

app.get("/api/action-center", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const upcomingDays = Number(req.query.upcomingDays || 7);
    res.json(getActionCenter(userId, upcomingDays));
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取今日行动中心失败' });
  }
});

app.get("/api/notification-preferences", authenticate, (req, res) => {
  const payload = (req as any).user as JwtPayload;
  const preference = db.getReminder(payload.userId);
  res.json({
    preference: {
      enabled: !!preference?.enabled,
      hour: preference?.hour ?? 8,
      minute: preference?.minute ?? 0,
      reminderEmail: preference?.reminder_email || payload.email,
      emailEnabled: preference?.email_enabled !== 0,
      inAppEnabled: preference?.in_app_enabled !== 0,
      browserEnabled: preference?.browser_enabled !== 0,
      timezone: preference?.timezone || 'Asia/Shanghai',
      quietHoursEnabled: !!preference?.quiet_hours_enabled,
      quietStart: preference?.quiet_start || '22:00',
      quietEnd: preference?.quiet_end || '08:00',
    },
  });
});

app.put("/api/notification-preferences", authenticate, (req, res) => {
  try {
    const payload = (req as any).user as JwtPayload;
    const current = db.getReminder(payload.userId);
    const reminderEmail = String(req.body.reminderEmail ?? current?.reminder_email ?? payload.email).trim();
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reminderEmail)) throw new Error('提醒邮箱格式不正确');
    if (!timePattern.test(req.body.quietStart || '22:00') || !timePattern.test(req.body.quietEnd || '08:00')) throw new Error('免打扰时间格式不正确');
    const now = new Date().toISOString();
    const saved = db.upsertReminder({
      id: current?.id || uuidv4(),
      user_id: payload.userId,
      enabled: req.body.enabled ?? !!current?.enabled ? 1 : 0,
      hour: Number(req.body.hour ?? current?.hour ?? 8),
      minute: Number(req.body.minute ?? current?.minute ?? 0),
      reminder_email: reminderEmail,
      email_enabled: req.body.emailEnabled === false ? 0 : 1,
      in_app_enabled: req.body.inAppEnabled === false ? 0 : 1,
      browser_enabled: req.body.browserEnabled === false ? 0 : 1,
      timezone: String(req.body.timezone || current?.timezone || 'Asia/Shanghai'),
      quiet_hours_enabled: req.body.quietHoursEnabled ? 1 : 0,
      quiet_start: String(req.body.quietStart || current?.quiet_start || '22:00'),
      quiet_end: String(req.body.quietEnd || current?.quiet_end || '08:00'),
      created_at: current?.created_at || now,
      updated_at: now,
    });
    res.json({ success: true, preference: saved });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '保存通知设置失败' });
  }
});

app.get("/api/notifications", authenticate, (req, res) => {
  const userId = (req as any).user.userId;
  const notifications = activityStore.listNotifications(userId, {
    status: req.query.status ? String(req.query.status) : undefined,
    channel: req.query.channel ? String(req.query.channel) : undefined,
    unreadOnly: req.query.unread === '1',
    limit: Number(req.query.limit || 100),
  });
  res.json({ notifications, unread: activityStore.listNotifications(userId, { unreadOnly: true, limit: 500 }).length });
});

app.post("/api/notifications/:id/read", authenticate, (req, res) => {
  const item = activityStore.markNotificationRead(req.params.id, (req as any).user.userId);
  if (!item) return res.status(404).json({ error: '通知不存在' });
  res.json({ notification: item });
});

app.post("/api/notifications/:id/retry", authenticate, (req, res) => {
  const item = activityStore.retryNotification(req.params.id, (req as any).user.userId);
  if (!item) return res.status(404).json({ error: '失败通知不存在' });
  res.json({ notification: item });
});

app.get("/api/history", authenticate, (req, res) => {
  const userId = (req as any).user.userId;
  const completions = activityStore.listCompletions(userId, {
    sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
    sourceId: req.query.sourceId ? String(req.query.sourceId) : undefined,
    date: req.query.date ? String(req.query.date) : undefined,
  }).map(item => ({ ...item, attachments: activityStore.listAttachments(userId, item.id) }));
  res.json({ completions });
});

app.post("/api/completions", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const sourceType = req.body.sourceType as activityStore.ActionSource;
    const sourceId = String(req.body.sourceId || '');
    const instanceId = req.body.instanceId ? String(req.body.instanceId) : null;
    if (sourceType === 'schedule') {
      const schedule = scheduleStore.getSchedule(sourceId);
      if (!schedule || schedule.user_id !== userId) return res.status(404).json({ error: '日程不存在' });
      scheduleStore.updateSchedule(sourceId, { is_completed: true });
    } else if (sourceType === 'reminder') {
      if (!instanceId) return res.status(400).json({ error: '周期编号不能为空' });
      const completedDate = req.body.completedAt
        ? String(req.body.completedAt).slice(0, 10)
        : reminderStore.todayInTimezone();
      const task = reminderStore.completeReminderCycle(sourceId, userId, instanceId, completedDate, req.body.note);
      if (!task) return res.status(404).json({ error: '周期事务不存在' });
      const completedCycle = reminderStore.getReminderHistory(task.id, userId).find(cycle => cycle.id === instanceId);
      if (completedCycle) reminderCalendarSync.syncReminderCycleToCalendar(task, completedCycle);
      reminderCalendarSync.syncReminderTaskToCalendar(task);
    } else {
      return res.status(400).json({ error: '完成记录来源不正确' });
    }
    const completion = activityStore.createCompletion({
      userId,
      sourceType,
      sourceId,
      instanceId,
      completedAt: req.body.completedAt,
      note: req.body.note,
      billDate: req.body.billDate,
    });
    res.json({ completion });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '登记完成失败' });
  }
});

app.post("/api/completions/:id/reopen", authenticate, (req, res) => {
  const userId = (req as any).user.userId;
  const current = activityStore.getCompletion(req.params.id, userId);
  if (!current) return res.status(404).json({ error: '完成记录不存在' });
  if (current.sourceType === 'schedule') scheduleStore.updateSchedule(current.sourceId, { is_completed: false });
  else if (current.instanceId) {
    const task = reminderStore.reopenReminderCycle(current.sourceId, userId, current.instanceId);
    const reopenedCycle = task
      ? reminderStore.getReminderHistory(task.id, userId).find(cycle => cycle.id === current.instanceId)
      : null;
    if (task && reopenedCycle) reminderCalendarSync.syncReminderCycleToCalendar(task, reopenedCycle);
    if (task) reminderCalendarSync.syncReminderTaskToCalendar(task);
  }
  res.json({ completion: activityStore.reopenCompletion(current.id, userId) });
});

app.put("/api/completions/:id", authenticate, (req, res) => {
  try {
    const completion = activityStore.updateCompletion(req.params.id, (req as any).user.userId, {
      completedAt: req.body.completedAt ? String(req.body.completedAt) : undefined,
      note: req.body.note === undefined ? undefined : String(req.body.note),
      billDate: req.body.billDate === undefined ? undefined : String(req.body.billDate),
    });
    if (!completion) return res.status(404).json({ error: '完成记录不存在' });
    res.json({ completion });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '修改完成记录失败' });
  }
});

app.post("/api/completions/:id/attachments", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    if (!activityStore.getCompletion(req.params.id, userId)) return res.status(404).json({ error: '完成记录不存在' });
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    if (!files.length || files.length > 5) return res.status(400).json({ error: '请选择 1 到 5 个附件' });
    const attachments = files.map((file: any) => attachmentService.saveBase64Attachment({
      userId,
      completionId: req.params.id,
      originalName: String(file.name || 'attachment'),
      mimeType: String(file.mimeType || ''),
      base64: String(file.base64 || ''),
    }));
    res.json({ attachments });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '上传附件失败' });
  }
});

app.get("/api/attachments/:id", authenticate, (req, res) => {
  try {
    const record = activityStore.getAttachment(req.params.id, (req as any).user.userId);
    if (!record) return res.status(404).json({ error: '附件不存在' });
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Content-Disposition', 'inline; filename*=UTF-8\'\'' + encodeURIComponent(record.originalName));
    res.send(attachmentService.readAttachment(record));
  } catch (error: any) {
    res.status(404).json({ error: error?.message || '读取附件失败' });
  }
});

app.delete("/api/attachments/:id", authenticate, (req, res) => {
  const userId = (req as any).user.userId;
  const record = activityStore.deleteAttachment(req.params.id, userId);
  if (!record) return res.status(404).json({ error: '附件不存在' });
  attachmentService.deleteAttachmentFileIfUnused(record);
  res.json({ success: true });
});

// ============= 用户备份与管理员灾备 =============

app.post("/api/backups/export", authenticate, (req, res) => {
  try {
    const password = String(req.body.password || '');
    const buffer = backupService.createUserBackup((req as any).user.userId, password);
    const filename = 'ai-calendar-' + reminderStore.todayInTimezone() + '.aicalendar-backup';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buffer);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '导出备份失败' });
  }
});

const backupRawBody = express.raw({ type: 'application/octet-stream', limit: '600mb' });

app.post("/api/backups/inspect", authenticate, backupRawBody, (req, res) => {
  try {
    const password = Buffer.from(String(req.header('x-backup-password') || ''), 'base64').toString('utf8');
    res.json({ backup: backupService.inspectUserBackup(req.body as Buffer, password) });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '检查备份失败' });
  }
});

app.post("/api/backups/restore", authenticate, backupRawBody, (req, res) => {
  try {
    const password = Buffer.from(String(req.header('x-backup-password') || ''), 'base64').toString('utf8');
    const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
    const result = backupService.restoreUserBackup((req as any).user.userId, req.body as Buffer, password, mode);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '恢复备份失败' });
  }
});

app.get("/api/admin/backups", authenticate, requireAdmin, (_req, res) => {
  res.json({ backups: backupService.listSystemSnapshots() });
});

app.post("/api/admin/backups", authenticate, requireAdmin, async (_req, res) => {
  try {
    const backup = backupService.createSystemSnapshot(true);
    const oss = await backupService.uploadPendingSystemSnapshots();
    res.json({ backup, oss });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '创建系统备份失败' });
  }
});

app.get("/api/admin/backups/:filename", authenticate, requireAdmin, (req, res) => {
  try {
    const buffer = backupService.readSystemSnapshot(req.params.filename);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(req.params.filename) + '"');
    res.send(buffer);
  } catch (error: any) {
    res.status(404).json({ error: error?.message || '备份不存在' });
  }
});

app.post("/api/admin/backups/restore", authenticate, requireAdmin, backupRawBody, (req, res) => {
  try {
    backupService.restoreSystemSnapshot(req.body as Buffer, String(req.header('x-restore-confirmation') || ''));
    res.json({ success: true, restartRequired: true });
    setTimeout(() => process.exit(0), 500);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '系统恢复失败' });
  }
});

// 更新提醒设置
app.put("/api/reminders", authenticate, (req, res) => {
  const payload = (req as any).user as JwtPayload;
  const { enabled, hour, minute } = req.body;
  const current = db.getReminder(payload.userId);
  const reminderEmail = String(req.body.reminderEmail ?? current?.reminder_email ?? payload.email).trim();
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return res.status(400).json({ error: '时间格式不正确' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reminderEmail)) {
    return res.status(400).json({ error: '提醒邮箱格式不正确' });
  }
  const reminder = db.upsertReminder({
    id: uuidv4(),
    user_id: payload.userId,
    enabled: enabled ? 1 : 0,
    hour: Number(hour),
    minute: Number(minute),
    reminder_email: reminderEmail,
    created_at: current?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  addLog('info', 'reminder', `提醒设置更新: userId=${payload.userId}, enabled=${enabled}, time=${hour}:${String(minute).padStart(2,'0')}`);
  res.json({ success: true, reminder: { enabled: !!reminder.enabled, hour: reminder.hour, minute: reminder.minute, reminderEmail } });
});

// ============= 周期提醒 API =============

function validDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normaliseReminderConfig(type: reminderStore.ReminderTaskType, input: any): reminderStore.ReminderConfig {
  if (type === 'credit_card') {
    const statementDay = Number(input?.statementDay);
    const paymentDay = Number(input?.paymentDay);
    const paymentMonthOffset = Number(input?.paymentMonthOffset) === 1 ? 1 : 0;
    if (statementDay < 1 || statementDay > 31 || paymentDay < 1 || paymentDay > 31) {
      throw new Error('账单日和还款日必须在 1 到 31 之间');
    }
    return {
      statementDay,
      paymentDay,
      paymentMonthOffset,
      reminderOffsets: Array.isArray(input?.reminderOffsets)
        ? input.reminderOffsets.map(Number).filter((value: number) => value >= 0 && value <= 60)
        : [15, 7, 1, 0],
    };
  }

  if (type === 'generic') {
    const allowedTemplates = ['subscription', 'insurance', 'document', 'membership', 'rent', 'utilities', 'vehicle_inspection', 'custom'];
    const templateKey = allowedTemplates.includes(input?.templateKey) ? input.templateKey : 'custom';
    const frequency = ['once', 'monthly', 'yearly', 'interval'].includes(input?.rule?.frequency) ? input.rule.frequency : 'once';
    const anchorDate = String(input?.rule?.anchorDate || reminderStore.todayInTimezone());
    if (!validDateOnly(anchorDate)) throw new Error('周期起始日期不正确');
    const interval = Math.min(Math.max(Number(input?.rule?.interval || 1), 1), 120);
    const advancePolicy = input?.rule?.advancePolicy === 'completion' ? 'completion' : 'calendar';
    let rule: reminderStore.RecurrenceRule;
    if (frequency === 'monthly') {
      const dayOfMonth = Math.min(Math.max(Number(input?.rule?.dayOfMonth || Number(anchorDate.slice(8, 10))), 1), 31);
      rule = { frequency, anchorDate, dayOfMonth, interval, advancePolicy };
    } else if (frequency === 'yearly') {
      const month = Math.min(Math.max(Number(input?.rule?.month || Number(anchorDate.slice(5, 7))), 1), 12);
      const dayOfMonth = Math.min(Math.max(Number(input?.rule?.dayOfMonth || Number(anchorDate.slice(8, 10))), 1), 31);
      rule = { frequency, anchorDate, month, dayOfMonth, interval, advancePolicy };
    } else if (frequency === 'interval') {
      const unit = ['day', 'month', 'year'].includes(input?.rule?.unit) ? input.rule.unit : 'day';
      rule = { frequency, anchorDate, unit, interval, advancePolicy };
    } else {
      rule = { frequency: 'once', anchorDate, advancePolicy: 'calendar' };
    }
    const reminderOffsets = Array.isArray(input?.reminderOffsets)
      ? [...new Set(input.reminderOffsets.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 365))]
      : [7, 1];
    return {
      templateKey,
      rule,
      reminderOffsets,
      reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(input?.reminderTime) ? input.reminderTime : '09:00',
      actionGuide: String(input?.actionGuide || '完成本周期事务并登记证明').trim(),
      priority: ['high', 'medium', 'low'].includes(input?.priority) ? input.priority : 'medium',
    };
  }

  const intervalDays = Number(input?.intervalDays || 180);
  if (!validDateOnly(input?.lastOperationDate) || intervalDays < 1 || intervalDays > 3650) {
    throw new Error('SIM 卡周期和上次有效操作日期不正确');
  }
  return {
    provider: String(input?.provider || '').trim(),
    numberMasked: String(input?.numberMasked || '').trim(),
    region: String(input?.region || '').trim(),
    intervalDays,
    lastOperationDate: input.lastOperationDate,
    actionGuide: String(input?.actionGuide || '完成一次充值、消费、短信、通话或流量操作').trim(),
    reminderOffsets: Array.isArray(input?.reminderOffsets)
      ? input.reminderOffsets.map(Number).filter((value: number) => value >= 0 && value <= 180)
      : [30, 15, 7, 1, 0],
  };
}

app.get("/api/cycle-reminders", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const tasks = reminderStore.listReminderTasks(userId);
    reminderCalendarSync.syncReminderTasksToCalendar(tasks);
    res.json({
      tasks,
      stats: reminderStore.getReminderStats(userId),
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取周期提醒失败' });
  }
});

app.get("/api/cycle-reminder-templates", authenticate, (_req, res) => {
  res.json({ templates: [
    { key: 'subscription', name: '订阅续费', frequency: 'monthly', reminderOffsets: [7, 1], icon: 'RefreshCw' },
    { key: 'insurance', name: '保险', frequency: 'yearly', reminderOffsets: [30, 7, 1], icon: 'ShieldCheck' },
    { key: 'document', name: '证件', frequency: 'once', reminderOffsets: [90, 30, 7], icon: 'BadgeCheck' },
    { key: 'membership', name: '会员', frequency: 'yearly', reminderOffsets: [14, 3, 1], icon: 'Crown' },
    { key: 'rent', name: '房租', frequency: 'monthly', reminderOffsets: [3, 1, 0], icon: 'House' },
    { key: 'utilities', name: '水电账单', frequency: 'monthly', reminderOffsets: [3, 1, 0], icon: 'ReceiptText' },
    { key: 'vehicle_inspection', name: '车辆年检', frequency: 'yearly', reminderOffsets: [30, 7, 1], icon: 'Car' },
    { key: 'custom', name: '自定义事务', frequency: 'once', reminderOffsets: [7, 1], icon: 'Settings2' },
  ] });
});

app.post("/api/cycle-reminders", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const type = req.body.type as reminderStore.ReminderTaskType;
    if (type !== 'credit_card' && type !== 'sim' && type !== 'generic') {
      return res.status(400).json({ error: '任务类型不正确' });
    }
    const task = reminderStore.createReminderTask({
      userId,
      type,
      name: String(req.body.name || ''),
      timezone: req.body.timezone || process.env.APP_TIMEZONE || 'Asia/Shanghai',
      config: normaliseReminderConfig(type, req.body.config),
    });
    reminderCalendarSync.syncReminderTaskToCalendar(task);
    addLog('info', 'reminder', '创建周期提醒任务: ' + task.name, { taskId: task.id, type });
    res.json({ task });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '创建周期提醒失败' });
  }
});

app.patch("/api/cycle-reminders/:id", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const current = reminderStore.getReminderTask(req.params.id, userId);
    if (!current) return res.status(404).json({ error: '周期提醒不存在' });
    const updates: any = {};
    if (req.body.name !== undefined) updates.name = String(req.body.name);
    if (req.body.enabled !== undefined) updates.enabled = !!req.body.enabled;
    if (req.body.timezone !== undefined) updates.timezone = String(req.body.timezone);
    if (req.body.config !== undefined) updates.config = normaliseReminderConfig(current.type, req.body.config);
    const task = reminderStore.updateReminderTask(req.params.id, userId, updates);
    if (task) reminderCalendarSync.syncReminderTaskToCalendar(task);
    res.json({ task });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '更新周期提醒失败' });
  }
});

app.delete("/api/cycle-reminders/:id", authenticate, (req, res) => {
  const userId = (req as any).user.userId;
  const cycles = reminderStore.getReminderHistory(req.params.id, userId);
  reminderCalendarSync.deleteReminderSchedules(userId, cycles);
  const success = reminderStore.deleteReminderTask(req.params.id, userId);
  if (!success) return res.status(404).json({ error: '周期提醒不存在' });
  addLog('warn', 'reminder', '删除周期提醒任务: ' + req.params.id);
  res.json({ success: true });
});

app.post("/api/cycle-reminders/:id/complete", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const completedDate = req.body.completedDate || reminderStore.todayInTimezone();
    if (!validDateOnly(completedDate)) return res.status(400).json({ error: '完成日期格式不正确' });
    const task = reminderStore.completeReminderCycle(
      req.params.id,
      userId,
      String(req.body.cycleId || ''),
      completedDate,
      req.body.note,
    );
    if (!task) return res.status(404).json({ error: '任务或周期不存在' });
    const completedCycle = reminderStore.getReminderHistory(task.id, userId)
      .find(cycle => cycle.id === String(req.body.cycleId || ''));
    if (completedCycle) reminderCalendarSync.syncReminderCycleToCalendar(task, completedCycle);
    reminderCalendarSync.syncReminderTaskToCalendar(task);
    const existingCompletion = activityStore.listCompletions(userId, { sourceType: 'reminder', sourceId: task.id })
      .find(item => item.instanceId === String(req.body.cycleId || '') && !item.reopenedAt);
    const completion = existingCompletion || activityStore.createCompletion({
      userId,
      sourceType: 'reminder',
      sourceId: task.id,
      instanceId: String(req.body.cycleId || ''),
      completedAt: new Date(completedDate + 'T12:00:00+08:00').toISOString(),
      note: req.body.note,
      billDate: req.body.billDate,
    });
    addLog('info', 'reminder', '标记周期提醒完成: ' + task.name, { taskId: task.id, completedDate });
    res.json({ task, completion });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '标记完成失败' });
  }
});

app.get("/api/cycle-reminders/:id/history", authenticate, (req, res) => {
  const userId = (req as any).user.userId;
  const history = reminderStore.getReminderHistory(req.params.id, userId);
  res.json({ history });
});

app.post("/api/cycle-reminders/test-email", authenticate, async (req, res) => {
  try {
    const payload = (req as any).user as JwtPayload;
    await sendReminderTestEmail(db.getReminderEmail(payload.userId) || payload.email);
    addLog('info', 'reminder', '周期提醒测试邮件发送成功');
    res.json({ success: true });
  } catch (error: any) {
    addLog('error', 'reminder', '周期提醒测试邮件发送失败: ' + (error?.message || error));
    res.status(500).json({ error: error?.message || '测试邮件发送失败' });
  }
});

// ============= AI 智能导入（草稿确认制） =============

app.post("/api/ai/imports/parse", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const apiKey = db.getUserApiKey(userId)?.api_key || process.env.CODEBUDDY_API_KEY;
    if (!apiKey) return res.status(400).json({ error: '请先在设置中配置 CodeBuddy API Key' });
    const images = Array.isArray(req.body.images) ? req.body.images.map((image: any) => ({
      name: String(image.name || 'image'),
      mimeType: String(image.mimeType || ''),
      base64: String(image.base64 || ''),
    })) : [];
    const draft = await parseAiImport({ text: String(req.body.text || ''), images, apiKey, model: scheduleModel });
    const record = activityStore.createAiImport({
      userId,
      sourceType: images.length ? 'image' : 'text',
      inputText: String(req.body.text || '') || null,
      draft,
    });
    res.json({ import: record });
  } catch (error: any) {
    const status = String(error?.message || '').includes('上一项导入') ? 429 : 400;
    res.status(status).json({ error: error?.message || 'AI 识别失败' });
  }
});

app.get("/api/ai/imports", authenticate, (req, res) => {
  res.json({ imports: activityStore.listAiImports((req as any).user.userId, String(req.query.status || 'draft')) });
});

app.get("/api/ai/imports/:id", authenticate, (req, res) => {
  const record = activityStore.getAiImport(req.params.id, (req as any).user.userId);
  if (!record) return res.status(404).json({ error: '导入草稿不存在' });
  res.json({ import: record });
});

app.post("/api/ai/imports/:id/confirm", authenticate, (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const current = activityStore.getAiImport(req.params.id, userId);
    if (!current || current.status !== 'draft') return res.status(404).json({ error: '导入草稿不存在或已经处理' });
    const draft = { ...current.draft, ...req.body.draft } as unknown as AiImportDraft;
    if (!draft.title || !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) return res.status(400).json({ error: '标题和到期日期不能为空' });
    let created: unknown;
    if (draft.kind === 'recurring') {
      const date = draft.dueDate;
      const task = reminderStore.createReminderTask({
        userId,
        type: 'generic',
        name: draft.title,
        timezone: process.env.APP_TIMEZONE || 'Asia/Shanghai',
        config: normaliseReminderConfig('generic', {
          templateKey: draft.templateKey,
          rule: {
            frequency: draft.recurrence?.frequency || 'once',
            anchorDate: date,
            dayOfMonth: Number(date.slice(8, 10)),
            month: Number(date.slice(5, 7)),
            interval: draft.recurrence?.interval || 1,
            unit: draft.recurrence?.unit || 'day',
            advancePolicy: draft.recurrence?.advancePolicy || 'calendar',
          },
          reminderOffsets: draft.reminderOffsets,
          reminderTime: draft.dueTime || '09:00',
          actionGuide: draft.actionGuide,
          priority: 'medium',
        }),
      });
      reminderCalendarSync.syncReminderTaskToCalendar(task);
      created = task;
    } else {
      created = scheduleStore.createSchedule({
        id: uuidv4(),
        user_id: userId,
        calendar_id: 'personal',
        type: 'todo',
        title: draft.title,
        description: draft.notes || undefined,
        start_time: draft.dueDate + 'T' + (draft.dueTime || '09:00') + ':00',
        end_time: undefined,
        all_day: !draft.dueTime,
        location: undefined,
        notes: draft.actionGuide || undefined,
        category: 'other',
        priority: 'medium',
        is_completed: false,
        is_repeated: false,
        repeat_rule: undefined,
        reminders: (draft.reminderOffsets || []).map(value => String(value)),
        is_high_risk: false,
      });
    }
    const confirmed = activityStore.confirmAiImport(req.params.id, userId, draft as unknown as Record<string, unknown>);
    res.json({ import: confirmed, created });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || '确认导入失败' });
  }
});

app.delete("/api/ai/imports/:id", authenticate, (req, res) => {
  const success = activityStore.deleteAiImport(req.params.id, (req as any).user.userId);
  if (!success) return res.status(404).json({ error: '导入草稿不存在' });
  res.json({ success: true });
});

app.get("/api/email-import/settings", authenticate, (req, res) => {
  res.json({
    setting: activityStore.getEmailImportSetting((req as any).user.userId),
    imapConfigured: !!process.env.IMAP_USER && !!process.env.IMAP_PASS,
  });
});

app.put("/api/email-import/settings", authenticate, (req, res) => {
  const setting = activityStore.updateEmailImportSetting((req as any).user.userId, !!req.body.enabled, !!req.body.regenerate);
  res.json({ setting });
});

app.post("/api/email-import/check", authenticate, async (req, res) => {
  const userId = (req as any).user.userId;
  const setting = activityStore.getEmailImportSetting(userId);
  if (!setting.enabled) return res.status(400).json({ error: '请先开启邮箱自动识别' });

  const result = await pollEmailImports({
    model: scheduleModel,
    onlyUserId: userId,
    resolveApiKey: targetUserId => db.getUserApiKey(targetUserId)?.api_key || process.env.CODEBUDDY_API_KEY || null,
    log: (message, error) => error
      ? addLog('error', 'ai', message, { error: error instanceof Error ? error.message : String(error) })
      : addLog('info', 'ai', message),
  });
  const statusCode = result.status === 'error' ? 502 : result.status === 'busy' ? 409 : 200;
  res.status(statusCode).json({ result });
});

// 更新会话
app.patch("/api/sessions/:sessionId", authenticate, (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, model } = req.body;
    const userId = ((req as any).user as JwtPayload).userId;
    
    const success = db.updateSession(sessionId, userId, { title, model });
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Update Session] Error:", error);
    res.status(500).json({ error: error?.message || "更新会话失败" });
  }
});

// 删除会话
app.delete("/api/sessions/:sessionId", authenticate, (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = ((req as any).user as JwtPayload).userId;
    const success = db.deleteSession(sessionId, userId);
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Session] Error:", error);
    res.status(500).json({ error: error?.message || "删除会话失败" });
  }
});

// ============= 日程管理 API =============

// 获取所有日程
app.get("/api/schedules", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { start, end } = req.query;
    if (userId) reminderCalendarSync.syncReminderTasksToCalendar(reminderStore.listReminderTasks(userId));
    let schedules;
    
    if (start && end) {
      schedules = scheduleStore.getSchedulesByDateRange(start as string, end as string, userId);
    } else {
      schedules = scheduleStore.getAllSchedules(userId);
    }
    
    res.json({ schedules });
  } catch (error: any) {
    console.error("[Schedules] Error:", error);
    res.status(500).json({ error: error?.message || "获取日程失败" });
  }
});

// 获取指定日期的日程
app.get("/api/schedules/date/:date", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { date } = req.params;
    if (userId) reminderCalendarSync.syncReminderTasksToCalendar(reminderStore.listReminderTasks(userId));
    const schedules = scheduleStore.getSchedulesByDate(date, userId);
    res.json({ schedules });
  } catch (error: any) {
    console.error("[Schedules] Error:", error);
    res.status(500).json({ error: error?.message || "获取日程失败" });
  }
});

// 获取单个日程
app.get("/api/schedules/:id", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    const schedule = scheduleStore.getSchedule(id);
    
    if (!schedule) {
      return res.status(404).json({ error: "日程不存在" });
    }
    
    // 验证日程属于当前用户
    if (schedule.user_id !== userId) {
      return res.status(403).json({ error: "无权访问该日程" });
    }
    
    res.json({ schedule });
  } catch (error: any) {
    console.error("[Schedule] Error:", error);
    res.status(500).json({ error: error?.message || "获取日程失败" });
  }
});

// 创建日程
app.post("/api/schedules", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const schedule = {
      id: uuidv4(),
      user_id: userId,
      ...req.body
    };
    
    const created = scheduleStore.createSchedule(schedule);
    addLog('info', 'schedule', `手动创建日程: ${schedule.title || '无标题'}`, {
      id: created?.id,
      all_day: schedule.all_day,
      start_time: schedule.start_time,
      category: schedule.category
    });
    res.json({ schedule: created });
  } catch (error: any) {
    addLog('error', 'schedule', `创建日程失败: ${error.message}`);
    console.error("[Create Schedule] Error:", error);
    res.status(500).json({ error: error?.message || "创建日程失败" });
  }
});

// 更新日程（PATCH）
app.patch("/api/schedules/:id", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    
    // 验证日程属于当前用户
    const existing = scheduleStore.getSchedule(id);
    if (!existing) {
      return res.status(404).json({ error: "日程不存在" });
    }
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: "无权修改该日程" });
    }
    
    const updated = scheduleStore.updateSchedule(id, req.body);
    addLog('info', 'schedule', `更新日程: ${updated?.title}`, {
      id: updated?.id,
      changes: req.body
    });
    res.json({ schedule: updated });
  } catch (error: any) {
    addLog('error', 'schedule', `更新日程失败: ${error.message}`);
    console.error("[Update Schedule] Error:", error);
    res.status(500).json({ error: error?.message || "更新日程失败" });
  }
});

// 更新日程（PUT - 与 PATCH 行为相同）
app.put("/api/schedules/:id", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    
    const existing = scheduleStore.getSchedule(id);
    if (!existing) {
      return res.status(404).json({ error: "日程不存在" });
    }
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: "无权修改该日程" });
    }
    
    const updated = scheduleStore.updateSchedule(id, req.body);
    res.json({ schedule: updated });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "更新日程失败" });
  }
});

// 删除日程
app.delete("/api/schedules/:id", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    
    const existing = scheduleStore.getSchedule(id);
    if (!existing) {
      return res.status(404).json({ error: "日程不存在" });
    }
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: "无权删除该日程" });
    }
    
    const success = scheduleStore.deleteSchedule(id);
    addLog('warn', 'schedule', `删除日程: ${id}`);
    res.json({ success: true });
  } catch (error: any) {
    addLog('error', 'schedule', `删除日程失败: ${error.message}`);
    console.error("[Delete Schedule] Error:", error);
    res.status(500).json({ error: error?.message || "删除日程失败" });
  }
});

// 切换日程完成状态
app.post("/api/schedules/:id/toggle", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params;
    
    const existing = scheduleStore.getSchedule(id);
    if (!existing) {
      return res.status(404).json({ error: "日程不存在" });
    }
    if (existing.user_id !== userId) {
      return res.status(403).json({ error: "无权操作该日程" });
    }
    
    const schedule = toggleScheduleCompletion(id, userId);
    const action = schedule?.is_completed ? '标记完成' : '取消完成';
    addLog('info', 'schedule', `${action}: ${schedule?.title}`, { id: schedule?.id });
    res.json({ schedule });
  } catch (error: any) {
    addLog('error', 'schedule', `切换状态失败: ${error.message}`);
    console.error("[Toggle Schedule] Error:", error);
    res.status(500).json({ error: error?.message || "操作失败" });
  }
});

// 获取所有分类
app.get("/api/categories", authenticate, (req, res) => {
  try {
    const categories = scheduleStore.getAllCategories((req as any).user.userId);
    res.json({ categories });
  } catch (error: any) {
    console.error("[Categories] Error:", error);
    res.status(500).json({ error: error?.message || "获取分类失败" });
  }
});

// 创建分类
app.post("/api/categories", authenticate, (req, res) => {
  try {
    const category = {
      id: uuidv4(),
      user_id: (req as any).user.userId,
      ...req.body
    };
    
    const created = scheduleStore.createCategory(category);
    addLog('info', 'schedule', `创建分类: ${category.name}`, { id: created?.id });
    res.json({ category: created });
  } catch (error: any) {
    addLog('error', 'schedule', `创建分类失败: ${error.message}`);
    console.error("[Create Category] Error:", error);
    res.status(500).json({ error: error?.message || "创建分类失败" });
  }
});

// 删除分类
app.delete("/api/categories/:id", authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const success = scheduleStore.deleteCategory(id, (req as any).user.userId);
    
    if (!success) {
      return res.status(400).json({ error: "无法删除该分类" });
    }
    
    addLog('warn', 'schedule', `删除分类: ${id}`);
    res.json({ success: true });
  } catch (error: any) {
    addLog('error', 'schedule', `删除分类失败: ${error.message}`);
    console.error("[Delete Category] Error:", error);
    res.status(500).json({ error: error?.message || "删除分类失败" });
  }
});

// ============= 日程表（Calendars）API =============

// 获取所有日程表
app.get("/api/calendars", authenticate, (req, res) => {
  try {
    const calendars = scheduleStore.getAllCalendars((req as any).user.userId);
    res.json({ calendars });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取日程表失败" });
  }
});

// 创建日程表
app.post("/api/calendars", authenticate, (req, res) => {
  try {
    const calendar = {
      id: uuidv4(),
      user_id: (req as any).user.userId,
      name: req.body.name || '新日程表',
      color: req.body.color || '#3B82F6',
      icon: req.body.icon || '📅',
      is_visible: true,
      is_default: false,
    };
    const created = scheduleStore.createCalendar(calendar);
    addLog('info', 'schedule', `创建日历: ${calendar.name}`, { id: created?.id });
    res.json({ calendar: created });
  } catch (error: any) {
    addLog('error', 'schedule', `创建日历失败: ${error.message}`);
    res.status(500).json({ error: error?.message || "创建日程表失败" });
  }
});

// 更新日程表
app.put("/api/calendars/:id", authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const updated = scheduleStore.updateCalendar(id, req.body, (req as any).user.userId);
    if (!updated) return res.status(404).json({ error: "日程表不存在" });
    addLog('info', 'schedule', `更新日历: ${updated.name}`, { id: updated.id });
    res.json({ calendar: updated });
  } catch (error: any) {
    addLog('error', 'schedule', `更新日历失败: ${error.message}`);
    res.status(500).json({ error: error?.message || "更新日程表失败" });
  }
});

// 删除日程表
app.delete("/api/calendars/:id", authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const success = scheduleStore.deleteCalendar(id, (req as any).user.userId);
    if (!success) return res.status(400).json({ error: "无法删除该日程表（默认日程表不可删除）" });
    addLog('warn', 'schedule', `删除日历: ${id}`);
    res.json({ success: true });
  } catch (error: any) {
    addLog('error', 'schedule', `删除日历失败: ${error.message}`);
    res.status(500).json({ error: error?.message || "删除日程表失败" });
  }
});

// ============= AI 日程解析 API =============

// AI 解析自然语言并自动创建日程（核心接口）
app.post("/api/ai-schedule", authenticate, async (req, res) => {
  const userId = (req as any).user?.userId;
  const { text, targetDate, model: reqModel, calendarId } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: "请输入日程描述" });
  }

  const today = targetDate || new Date().toISOString().split('T')[0];
  const selectedModel = reqModel || scheduleModel || defaultModel;
  const targetCalendarId = calendarId || 'personal';

  // 构造解析提示词
  const parsePrompt = `你是一个日程解析专家。请将以下自然语言描述解析为结构化的日程列表。

当前日期：${today}

用户输入：${text}

请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{
  "schedules": [
    {
      "type": "event",
      "title": "任务名称",
      "start_time": "YYYY-MM-DDTHH:MM:00",
      "end_time": "YYYY-MM-DDTHH:MM:00",
      "all_day": false,
      "location": "地点或null",
      "notes": "AI建议或注意事项，如无则null",
      "category": "travel/work/social/life/health/other",
      "priority": "high/medium/low"
    }
  ],
  "summary": "一句话总结今日安排"
}

解析规则：
1. type 字段：有具体时间段的用 "event"，只有一个时间点或全天的用 "todo"
2. 时间推断：
   - "上午" → 09:00
   - "中午" → 12:00  
   - "下午" → 14:00
   - "傍晚" → 17:00
   - "晚上/晚饭" → 18:30
3. 默认耗时：接人=30min, 会议=90min, 餐饮=90min, 购物=60min, 出行单程=30min
4. 多地点任务之间自动预留30分钟通勤时间
5. notes 填写有用的提示，比如"建议提前查看列车到站时间"、"建议预约餐位"等
6. category 根据任务性质选择：travel(出行/接送), work(工作/会议), social(社交/餐饮), life(生活), health(健康)
7. 如果用户提到"待办"、"记得"、"提醒"等，type 用 "todo"
8. priority 优先级识别规则（重要，必须严格执行）：
   - high（高）：含有"重要"、"紧急"、"关键"、"必须"、"立即"、"尽快"、"今天必须"、"截止"、"ddl"等词
   - low（低）：含有"随便"、"有空"、"顺便"、"可选"、"不急"、"闲了"等词
   - medium（中）：其他情况默认使用中优先级
   - 注意：接送人、开会等日程通常为medium；如会议前有"非常重要"修饰则为high`;

  try {
    // 使用 SDK query 解析
    let jsonText = '';
    
    const stream = query({
      prompt: parsePrompt,
      options: {
        cwd: process.cwd(),
        model: selectedModel,
        maxTurns: 1,
        systemPrompt: '你是一个 JSON 解析器。只输出合法的 JSON，不要有任何其他文字。',
        // env 参数已移除 - SDK 会自动从 process.env 读取 CODEBUDDY_API_KEY
      }
    });

    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            jsonText += block.text;
          }
        }
      }
    }

    // 提取 JSON
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI 返回格式错误');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const schedulesToCreate = parsed.schedules || [];

    // 批量创建日程
    const created = scheduleStore.createSchedulesBatch(
      schedulesToCreate.map((s: any) => ({
        id: uuidv4(),
        user_id: userId,
        calendar_id: targetCalendarId,
        type: s.type || 'event',
        title: s.title,
        description: null,
        start_time: s.start_time,
        end_time: s.end_time || null,
        all_day: s.all_day || false,
        location: s.location || null,
        notes: s.notes || null,
        category: s.category || 'other',
        priority: s.priority || 'medium',
        is_completed: false,
        is_repeated: false,
        repeat_rule: null,
        reminders: []
      }))
    );

    res.json({
      success: true,
      schedules: created,
      summary: parsed.summary || `已为您创建 ${created.length} 个日程`,
      count: created.length
    });

  } catch (error: any) {
    console.error('[AI Schedule] Error:', error);
    res.status(500).json({ error: error?.message || 'AI 解析失败，请重试' });
  }
});

// ============= AI 智能对话接口（双向交互） =============

// 【增强】解析用户消息中的日期（支持更多相对日期）
function parseQueryDatesForCards(message: string, todayStr: string): string[] {
  const now = new Date();
  const today = todayStr || getLocalDateString(now);
  const msgLower = message.toLowerCase();
  const msgRaw = message;
  const dates: string[] = [];
  
  const addDate = (dateStr: string) => {
    if (!dates.includes(dateStr)) dates.push(dateStr);
  };
  
  // 【关键修复】先检测"今天"，否则默认返回今天
  const hasToday = msgLower.includes('今天') || msgLower.includes('今日') || msgLower.includes('本日');
  if (hasToday) {
    addDate(today);
  }
  
  // 辅助函数：计算N天后的日期（本地时区）
  const getDateStr = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return getLocalDateString(d);
  };
  
  const tomorrowStr = getDateStr(1);
  const dayAfterTomorrowStr = getDateStr(2);
  const yesterdayStr = getDateStr(-1);
  
  // 检测"明天"
  const hasTomorrow = msgLower.includes('明天') || msgLower.includes('明日') || msgLower.includes('tomorrow');
  if (hasTomorrow) {
    addDate(tomorrowStr);
  }
  
  // 检测"后天"
  const hasDayAfter = msgLower.includes('后天') || msgLower.includes('后日');
  if (hasDayAfter) {
    addDate(dayAfterTomorrowStr);
  }
  
  // 【新增】检测"两天后"、"3天后"等
  const afterMatch = msgRaw.match(/(\d+)天后?/);
  if (afterMatch) {
    const days = parseInt(afterMatch[1]);
    if (days >= 1 && days <= 30) {
      addDate(getDateStr(days));
    }
  }
  
  // 检测"昨天"
  const hasYesterday = msgLower.includes('昨天') || msgLower.includes('昨日') || msgLower.includes('yesterday');
  if (hasYesterday) {
    addDate(yesterdayStr);
  }
  
  // 【新增】检测"大前天"、"前天"
  const hasDayBeforeYesterday = msgLower.includes('大前天') || msgLower.includes('大前日');
  if (hasDayBeforeYesterday) {
    addDate(getDateStr(-3));
  }
  const hasTwoDaysAgo = msgLower.includes('前天');
  if (hasTwoDaysAgo) {
    addDate(getDateStr(-2));
  }
  
  // 【新增】检测"本周"
  const hasThisWeek = msgLower.includes('本周') || msgLower.includes('这周') || msgLower.includes('this week');
  if (hasThisWeek) {
    // 本周：从今天到本周日
    const dayOfWeek = now.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    for (let i = 0; i <= daysUntilSunday; i++) {
      addDate(getDateStr(i));
    }
  }
  
  // 【新增】检测"下周"
  const hasNextWeek = msgLower.includes('下周') || msgLower.includes('下星期') || msgLower.includes('next week');
  if (hasNextWeek) {
    const nextWeekStart = getDateStr(7 - now.getDay() + 1); // 下周一
    for (let i = 0; i < 7; i++) {
      addDate(getDateStr(7 - now.getDay() + 1 + i));
    }
  }
  
  // 【新增】检测"本月"
  const hasThisMonth = msgLower.includes('本月') || msgLower.includes('这月');
  if (hasThisMonth) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = now.getDate(); d <= lastDay; d++) {
      const dt = new Date(now.getFullYear(), now.getMonth(), d);
      addDate(getLocalDateString(dt));
    }
  }
  
  // 下周几
  const getNextWeekday = (d: number) => {
    const daysUntil = (d - now.getDay() + 7) % 7 || 7;
    const dt = new Date(now);
    dt.setDate(dt.getDate() + daysUntil);
    return getLocalDateString(dt);
  };
  
  if (msgLower.includes('下周一') || msgLower.includes('下星期一')) addDate(getNextWeekday(1));
  if (msgLower.includes('下周二') || msgLower.includes('下星期二')) addDate(getNextWeekday(2));
  if (msgLower.includes('下周三') || msgLower.includes('下星期三')) addDate(getNextWeekday(3));
  if (msgLower.includes('下周四') || msgLower.includes('下星期四')) addDate(getNextWeekday(4));
  if (msgLower.includes('下周五') || msgLower.includes('下星期五')) addDate(getNextWeekday(5));
  if (msgLower.includes('下周六') || msgLower.includes('下星期六')) addDate(getNextWeekday(6));
  if (msgLower.includes('下周日') || msgLower.includes('下星期日') || msgLower.includes('下周末')) addDate(getNextWeekday(0));
  
  // 周几（本周）
  const getThisWeekday = (d: number) => {
    const daysUntil = (d - now.getDay() + 7) % 7;
    const dt = new Date(now);
    dt.setDate(dt.getDate() + daysUntil);
    return getLocalDateString(dt);
  };
  
  if (msgLower.includes('周一') || msgLower.includes('星期一')) addDate(getThisWeekday(1));
  if (msgLower.includes('周二') || msgLower.includes('星期二')) addDate(getThisWeekday(2));
  if (msgLower.includes('周三') || msgLower.includes('星期三')) addDate(getThisWeekday(3));
  if (msgLower.includes('周四') || msgLower.includes('星期四')) addDate(getThisWeekday(4));
  if (msgLower.includes('周五') || msgLower.includes('星期五')) addDate(getThisWeekday(5));
  if (msgLower.includes('周六') || msgLower.includes('星期六')) addDate(getThisWeekday(6));
  if (msgLower.includes('周日') || msgLower.includes('星期日') || msgLower.includes('周末')) addDate(getThisWeekday(0));
  
  // 具体日期：4月10号、4-10、2026-04-10
  const patterns = [/(\d{1,2})月(\d{1,2})[日号]?/g, /(\d{1,2})-(\d{1,2})/g, /(\d{4})-(\d{1,2})-(\d{1,2})/g];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(msgRaw)) !== null) {
      let year = now.getFullYear(), month, day;
      if (m[3]) { year = parseInt(m[1]); month = parseInt(m[2]); day = parseInt(m[3]); }
      else { month = parseInt(m[1]); day = parseInt(m[2]); }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const dt = new Date(year, month - 1, day);
        const daysDiff = Math.floor((dt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff >= -7 && daysDiff <= 60) addDate(getLocalDateString(dt));
      }
    }
  }
  
  // 【关键】默认只返回今天
  if (dates.length === 0) {
    addDate(today);
    // 如果没有检测到任何日期引用，默认也添加明天以便AI有更多上下文
    addDate(tomorrowStr);
  }
  
  return dates;
}

// 检查登录状态的辅助函数
const AI_CATEGORY_LABELS_CN: Record<string, string> = {
  travel: '出行', work: '工作', social: '社交', life: '生活', health: '健康', other: '其他'
};

function formatAiQueryDateLabel(dateStr: string) {
  const date = new Date(`${dateStr}T12:00:00`);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
}

function joinAiLabels(labels: string[]) {
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return labels.join('和');
  return labels.slice(0, -1).join('、') + '和' + labels[labels.length - 1];
}

function buildCompactScheduleQueryReply(items: any[], queryDates: string[], today: string) {
  const subject = queryDates.length === 1 && queryDates[0] === today
    ? '今天'
    : queryDates.map(formatAiQueryDateLabel).join('、') || '所选日期';
  if (items.length === 0) return `${subject}暂无安排。`;

  const describePeriod = (label: string, periodItems: any[]) => {
    if (periodItems.length === 0) return '';
    const categories = [...new Set(periodItems.map(item => AI_CATEGORY_LABELS_CN[item.category] || '其他'))];
    return `${label}有${joinAiLabels(categories)}安排`;
  };
  const allDayItems = items.filter(item => item.all_day);
  const timedItems = items.filter(item => !item.all_day);
  const morning = timedItems.filter(item => Number(item.start_time.slice(11, 13)) < 12);
  const afternoon = timedItems.filter(item => {
    const hour = Number(item.start_time.slice(11, 13));
    return hour >= 12 && hour < 18;
  });
  const evening = timedItems.filter(item => Number(item.start_time.slice(11, 13)) >= 18);
  const details = [
    describePeriod('上午', morning),
    describePeriod('下午', afternoon),
    describePeriod('晚上', evening),
    allDayItems.length > 0 ? `另有 ${allDayItems.length} 项全天安排` : '',
  ].filter(Boolean);
  const density = items.length >= 4 ? '日程较满' : '已有安排';
  const summary = details.length > 0
    ? `${subject}${density}，${details.join('，')}，请注意合理安排时间。`
    : `${subject}${density}，请注意合理安排时间。`;
  return `${subject}共有 ${items.length} 项安排，以下是详情：\n\n${summary}`;
}

function isReadOnlyScheduleQuery(text: string) {
  const normalized = text.replace(/\s+/g, '');
  if (/(添加|新建|创建|修改|改成|推迟|提前|取消|删除|删掉|标记完成|帮我安排|给我安排|提醒我)/.test(normalized)) {
    return false;
  }
  return /(有什么安排|有哪些安排|什么安排|有什么日程|有哪些日程|查看.*(?:安排|日程)|查询.*(?:安排|日程)|几点有会)/.test(normalized);
}

app.post("/api/ai-chat", authenticate, async (req, res) => {
  const { text, targetDate, model: reqModel, calendarId, scheduleContext } = req.body;
  if (!text) return res.status(400).json({ error: "请输入内容" });

  // 记录 AI 对话请求日志
  addLog('info', 'ai', `收到对话请求: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`, { targetDate, model: reqModel });

  // 【修复数据隔离】先提取用户ID和API Key
  let userId = 'default';
  let userCredential: dbModule.DbUserApiKey | undefined;
  let authenticatedUser = false;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
      userId = payload.userId;
      authenticatedUser = true;
      // 获取该用户的 API Key
      const userKey = db.getUserApiKey(userId);
      userCredential = userKey || undefined;
    } catch {}
  }

  // 只读日程查询直接使用本地数据，不依赖外部 AI 或 API Key。
  if (authenticatedUser && isReadOnlyScheduleQuery(text)) {
    const today = targetDate || getLocalDateString();
    const queryDates = parseQueryDatesForCards(text, today);
    const scheduleItems: any[] = [];
    const seenScheduleIds = new Set<string>();
    for (const dateStr of queryDates) {
      const schedules = scheduleStore.getSchedulesByDate(dateStr, userId);
      for (const schedule of schedules) {
        if (!seenScheduleIds.has(schedule.id)) {
          seenScheduleIds.add(schedule.id);
          scheduleItems.push(schedule);
        }
      }
    }
    scheduleItems.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    addLog('info', 'ai', `本地完成日程查询，共 ${scheduleItems.length} 项`, { userId, queryDates });
    return res.json({
      success: true,
      intent: 'query',
      reply: buildCompactScheduleQueryReply(scheduleItems, queryDates, today),
      scheduleItems,
      changed: false,
      changedDetails: { created: [], updated: [], deleted: [] },
    });
  }

  // 检查用户是否有 API Key
  if (!userCredential) {
    addLog('warn', 'ai', `用户 ${userId} 未配置 API Key`, { userId });
    return res.status(401).json({ 
      error: '请先在设置页输入您的 CodeBuddy API Key',
      needLogin: true 
    });
  }

  // 【关键】使用该用户的 API Key 进行认证检查
  let needsLogin = false;
  let loginError: string | undefined;
  try {
    await unstable_v2_authenticate({
      environment: 'internal',
      env: buildCodeBuddyEnv(userCredential),
      onAuthUrl: async () => {
        needsLogin = true;
        loginError = 'API Key 无效，请检查或重新输入';
      }
    });
    if (needsLogin) {
      return res.status(401).json({ error: loginError });
    }
  } catch (error: any) {
    return res.status(401).json({ error: error?.message || 'API Key 认证失败' });
  }

  const today = targetDate || getLocalDateString();
  const selectedModel = reqModel || scheduleModel || defaultModel;
  const targetCalendarId = calendarId || 'personal';

  // 【关键修复】先解析用户消息中的日期，获取正确的日程作为AI上下文
  const queryDates = parseQueryDatesForCards(text, today);
  console.log('[AI Chat] Query dates for AI context:', queryDates);
  
  // 获取用户询问日期的日程（而非仅仅今天的）
  const contextSchedules: any[] = [];
  const seenIds = new Set<string>();
  for (const dateStr of queryDates) {
    const schedules = scheduleStore.getSchedulesByDate(dateStr, userId);
    for (const s of schedules) {
      if (!seenIds.has(s.id)) {
        seenIds.add(s.id);
        contextSchedules.push(s);
      }
    }
  }
  
  // 格式化日期标签
  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return `${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
  };
  const dateLabels = queryDates.map(formatDateLabel).join('、');
  const queryDateInfo = queryDates.length > 0 
    ? `【重要】用户询问的日期：${dateLabels}。请根据这些日期的日程回复！\n\n` 
    : '';

  // 简化日期的上下文日程
  const existingSchedules = contextSchedules;

  const CATEGORY_LABELS_CN = AI_CATEGORY_LABELS_CN;
  
  // 按时间排序日程，格式化更清晰的卡片展示（无emoji）
  const sortedSchedules = [...existingSchedules].sort((a, b) => 
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
  
  // 纯文本版（用于 AI 上下文）- 显示完整日期

  const formatDateForAI = (dateStr: string) => {
    const d = new Date(dateStr);
    const month = dateStr.slice(5, 7);
    const day = dateStr.slice(8, 10);
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return `${month}月${day}日(${weekday})`;
  };
  const scheduleList = sortedSchedules.length > 0
    ? sortedSchedules.map((s: any, idx: number) => {
        const categoryLabel = CATEGORY_LABELS_CN[s.category] || '其他';
        const dateLabel = formatDateForAI(s.start_time.slice(0, 10));
        const timeLabel = s.all_day ? '全天' : `${s.start_time.slice(11, 16)}${s.end_time ? '~' + s.end_time.slice(11, 16) : ''}`;
        const status = s.is_completed ? '已完成' : '进行中';
        const loc = s.location ? `\n   地点: ${s.location}` : '';
        const notes = s.notes ? `\n   备注: ${s.notes}` : '';
        const cat = s.category || 'other';
        const pri = s.priority || 'medium';
        return `${idx + 1}. ${categoryLabel} "${s.title}" ${status}\n   日期时间: ${dateLabel} ${timeLabel}${loc}${notes}\n   分类: ${cat} | 优先级: ${pri}\n   [ID: ${s.id}]`;
      }).join('\n\n')
    : '（该日期暂无日程）';

  const systemPrompt = `你是一个专业的智能日程助手，能够精准理解用户的日程需求，并准确执行增删改查操作。

${queryDateInfo}当前日期：${today}

【重要】以下是用户日程表数据（这是你回答的基础，必须基于此回复）：
${scheduleList || '（暂无日程）'}

【回复规则 - 非常重要】
1. 必须基于上面的真实日程数据回复，不得凭空捏造
2. query 意图不要在 reply 中逐项罗列标题、时间、地点或备注，详情由下方日程卡片展示
3. query 意图只输出两段：第一段说明共有几项，第二段概括上午、下午、晚上和全天安排
4. 回复中禁止使用 emoji 或图标字符，保持简洁专业
5. create、update、delete 意图只简洁说明操作结果

可用日程分类：
- travel/出行：交通、接送、旅途相关
- work/工作：上班、会议、任务、工作相关
- social/社交：朋友聚会、饭局、社交活动
- life/生活：购物、家务、日常琐事
- health/健康：运动、看病、健身、休息
- other/其他：不属于以上分类的事项

请严格按照以下 JSON 格式响应：
{
  "intent": "create|update|delete|query|chat",
  "reply": "给用户的自然语言回复（必填，要基于上面提供的日程列表来回复，不要凭空捏造）",
  "operations": [
    {
      "type": "create|update|delete",
      "scheduleId": "修改/删除时填写已有日程的完整UUID，必须从上面日程列表的 [ID:xxxx] 复制完整值！",
      "data": {
        "title": "日程标题",
        "start_time": "YYYY-MM-DDTHH:MM:00",
        "end_time": "YYYY-MM-DDTHH:MM:00 或 null",
        "all_day": false,
        "location": "地点或null",
        "notes": "备注或null",
        "category": "travel/work/social/life/health/other",
        "priority": "high/medium/low",
        "type": "event/todo"
      }
    }
  ]
}

意图识别规则（重要）：
- create: 新建/添加/安排日程（"今天上午去..."、"安排..."、"提醒我..."）
- update: 修改已有日程（"把...改成..."、"...推迟到..."、"晚饭改7点"）
- delete: 删除日程（"取消..."、"删掉..."、"不要..."）
- query: 查询日程（"今天有什么安排"、"我几点有会"）
- chat: 纯聊天、问建议（不操作日程）

时间识别技巧：
- "上午"→09:00，"中午"→12:00，"下午"→14:00，"傍晚"→17:00，"晚上"→19:00
- "半点"如"9点半"→09:30，"1点半"→13:30
- 默认时长：会议90min，吃饭60min，接人30min

category 智能匹配：
- 提到"开车"、"坐车"、"接人"、"送人"、"高铁"、"飞机"→ travel
- 提到"开会"、"上班"、"工作"、"报告"、"PPT"→ work
- 提到"朋友"、"聚餐"、"约会"、"饭局"、"聚会"→ social
- 提到"买菜"、"做饭"、"家务"、"购物"→ life
- 提到"运动"、"跑步"、"健身"、"看病"→ health

priority 识别：
- high: "重要"、"紧急"、"关键"、"必须"、"尽快"、"截止"、"ddl"
- low: "随便"、"有空"、"顺便"、"不急"、"闲了再说"
- medium: 其他普通日程

重要提醒：
1. scheduleId 必须从日程列表中精确匹配！
2. operations 数组在 chat/query 意图时为空
3. update 操作只填需要修改的字段
4. 多任务时解析成多个 create 操作
5. 保持回复简洁专业

请严格按照以下 JSON 格式响应，不要输出任何其他内容：
{
  "intent": "create|update|delete|query|chat",
  "reply": "给用户的自然语言回复（必填，要友好、简洁）",
  "operations": [
    {
      "type": "create|update|delete",
      "scheduleId": "修改/删除时填写已有日程的id（从上面列表复制）",
      "data": {
        "title": "...",
        "start_time": "YYYY-MM-DDTHH:MM:00",
        "end_time": "YYYY-MM-DDTHH:MM:00 或 null",
        "all_day": false,
        "location": "地点或null",
        "notes": "AI建议或null",
        "category": "travel/work/social/life/health/other",
        "priority": "high/medium/low",
        "type": "event/todo"
      }
    }
  ]
}

意图识别规则：
- create: 用户要新建/添加/安排日程（"今天上午..."、"帮我安排..."）
- update: 用户要修改已有日程（"把...改成..."、"...推迟到..."、"晚饭改成7点"）
- delete: 用户要删除日程（"取消..."、"删掉..."）
- query: 用户在问今天/某天的安排（"今天有什么"、"我几点有会"）
- chat: 纯聊天，问天气/建议/其他（不操作日程）

priority 识别：
- high: 含"重要""紧急""关键""必须""截止""ddl"
- low: 含"随便""有空""顺便""不急"
- medium: 其他情况

修改时 scheduleId 必须从已有日程列表中精确匹配，operations 数组可以为空（chat/query意图时）。`;

  try {
    let jsonText = '';
    
    // 【修复数据隔离】使用该用户的 API Key
    const stream = query({
      prompt: text,
      options: {
        cwd: process.cwd(),
        model: selectedModel,
        maxTurns: 1,
        systemPrompt,
        env: buildCodeBuddyEnv(userCredential),
      }
    });

    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') jsonText += block.text;
        }
      }
    }

    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回格式错误');

    const parsed = JSON.parse(jsonMatch[0]);
    const operations = parsed.operations || [];
    console.log('[AI Chat] Intent:', parsed.intent);
    console.log('[AI Chat] Operations:', JSON.stringify(operations, null, 2));
    addLog('info', 'ai', `AI解析完成，意图: ${parsed.intent}，操作数: ${operations.length}`, {
      intent: parsed.intent,
      opCount: operations.length,
      reply: (parsed.reply || '').slice(0, 80)
    });
    
    const createdSchedules: any[] = [];
    const updatedSchedules: any[] = [];
    const deletedIds: string[] = [];

    for (const op of operations) {
      if (op.type === 'create' && op.data?.title) {
        try {
          addLog('info', 'schedule', `创建日程: ${op.data.title}`, {
            end_time: op.data.end_time,
            all_day: op.data.all_day,
            type: op.data.type
          });
          const created = scheduleStore.createSchedule({
            id: uuidv4(),
            user_id: userId,
            calendar_id: targetCalendarId,
            type: op.data.type || 'event',
            title: op.data.title,
            description: undefined,
            start_time: op.data.start_time || (today + 'T09:00:00'),
            end_time: op.data.end_time,
            all_day: op.data.all_day === true,
            location: op.data.location || undefined,
            notes: op.data.notes || undefined,
            category: op.data.category || 'other',
            priority: op.data.priority || 'medium',
            is_completed: false,
            is_repeated: false,
            reminders: [],
            is_high_risk: false,
          });
          if (created) {
            createdSchedules.push(created);
            addLog('info', 'schedule', `创建成功: ${op.data.title}`, { id: created.id });
          }
        } catch (err: any) {
          addLog('error', 'schedule', `创建失败: ${op.data.title}`, { error: err.message });
          console.error('[AI Chat] 创建日程失败:', err.message);
        }
      } else if (op.type === 'update' && op.scheduleId && op.data) {
        const target = scheduleStore.getSchedule(op.scheduleId);
        if (!target || target.user_id !== userId) {
          addLog('warn', 'schedule', 'AI 尝试修改无权访问的日程', { userId, scheduleId: op.scheduleId });
          continue;
        }
        console.log('[AI Chat] Updating schedule:', op.scheduleId, 'with:', op.data);
        const updated = scheduleStore.updateSchedule(op.scheduleId, op.data);
        if (updated) {
          updatedSchedules.push(updated);
          console.log('[AI Chat] Update successful:', updated);
        } else {
          console.log('[AI Chat] Update failed - schedule not found or error');
        }
      } else if (op.type === 'delete' && op.scheduleId) {
        const target = scheduleStore.getSchedule(op.scheduleId);
        if (!target || target.user_id !== userId) {
          addLog('warn', 'schedule', 'AI 尝试删除无权访问的日程', { userId, scheduleId: op.scheduleId });
          continue;
        }
        console.log('[AI Chat] Deleting schedule:', op.scheduleId);
        scheduleStore.deleteSchedule(op.scheduleId);
        deletedIds.push(op.scheduleId);
      }
    }

    console.log('[AI Chat] Summary - created:', createdSchedules.length, 'updated:', updatedSchedules.length, 'deleted:', deletedIds.length);
    
    const changed = createdSchedules.length + updatedSchedules.length + deletedIds.length > 0;
    let finalScheduleItems = sortedSchedules;
    if (changed) {
      const allSchedules: any[] = [];
      const seenFinalIds = new Set<string>();
      for (const dateStr of queryDates) {
        const schedules = scheduleStore.getSchedulesByDate(dateStr, userId);
        for (const schedule of schedules) {
          if (!seenFinalIds.has(schedule.id)) {
            seenFinalIds.add(schedule.id);
            allSchedules.push(schedule);
          }
        }
      }
      finalScheduleItems = allSchedules.sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );
    }

    const finalReply = parsed.intent === 'query'
      ? buildCompactScheduleQueryReply(finalScheduleItems, queryDates, today)
      : (parsed.reply || '好的');

    // 返回结构化日程，前端渲染为可点击卡片并复用日历详情操作
    res.json({
      success: true,
      intent: parsed.intent || 'chat',
      reply: finalReply,
      scheduleItems: finalScheduleItems,
      // 日程变更信息用于前端判断是否需要刷新日历
      changed,
      changedDetails: {
        created: createdSchedules,
        updated: updatedSchedules,
        deleted: deletedIds,
      },
    });
  } catch (error: any) {
    addLog('error', 'ai', `AI Chat 处理失败: ${error?.message || '未知错误'}`, { stack: error?.stack?.slice(0, 200) });
    console.error('[AI Chat] Error:', error);
    res.status(500).json({ error: error?.message || 'AI 处理失败，请重试' });
  }
});

// 获取某日日程（供 AI 对话上下文）
app.get("/api/schedules/by-date/:date", authenticate, (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    const { date } = req.params;
    const schedules = scheduleStore.getSchedulesByDate(date, userId);
    res.json({ schedules });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取失败' });
  }
});

// ============= 聊天 API =============

// 权限响应 API
app.post("/api/permission-response", authenticate, (req, res) => {
  const { requestId, behavior, message } = req.body;
  
  console.log(`[Permission] Response received: requestId=${requestId}, behavior=${behavior}`);
  
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    console.log(`[Permission] Request not found: ${requestId}`);
    return res.status(404).json({ error: "权限请求不存在或已超时" });
  }
  if (pending.userId !== ((req as any).user as JwtPayload).userId) {
    return res.status(403).json({ error: "无权处理该权限请求" });
  }
  
  // 清除请求
  pendingPermissions.delete(requestId);
  
  if (behavior === 'allow') {
    pending.resolve({
      behavior: 'allow',
      updatedInput: pending.input
    });
  } else {
    pending.resolve({
      behavior: 'deny',
      message: message || '用户拒绝了此操作'
    });
  }
  
  res.json({ success: true });
});

// 发送消息并获取流式响应
app.post("/api/chat", authenticate, async (req, res) => {
  const { sessionId, message, model, systemPrompt, cwd, permissionMode } = req.body;
  const userId = ((req as any).user as JwtPayload).userId;
  const userCredential = db.getUserApiKey(userId);
  
  // 请求日志
  console.log(`\n[Chat] ========== 新请求 ==========`);
  console.log(`[Chat] SessionId: ${sessionId}`);
  console.log(`[Chat] Model: ${model}`);
  console.log(`[Chat] Message: ${message?.slice(0, 100)}${message?.length > 100 ? '...' : ''}`);
  console.log(`[Chat] CWD: ${cwd || 'default'}`);

  if (!message) {
    console.log(`[Chat] 错误: 消息为空`);
    return res.status(400).json({ error: "消息不能为空" });
  }
  if (!userCredential) {
    return res.status(401).json({ error: "请先在设置页输入您的 CodeBuddy API Key" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId, userId) : null;
  const now = new Date().toISOString();
  
  if (!session) {
    // 创建新会话
    console.log(`[Chat] 创建新会话`);
    session = db.createSession({
      id: sessionId || uuidv4(),
      user_id: userId,
      title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
      model: model || defaultModel,
      sdk_session_id: null,  // 稍后从 SDK 获取
      created_at: now,
      updated_at: now
    });
  } else {
    console.log(`[Chat] 使用现有会话, SDK Session: ${session.sdk_session_id || 'none'}`);
  }

  const selectedModel = model || session.model;
  
  // 获取 SDK session ID（用于恢复对话）
  const sdkSessionId = session.sdk_session_id;

  // 创建用户消息 ID 和助手消息 ID
  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  // 保存用户消息到数据库
  try {
    db.createMessage({
      id: userMessageId,
      session_id: session.id,
      role: 'user',
      content: message,
      model: null,
      created_at: now,
      tool_calls: null
    }, userId);
    console.log(`[Chat] 用户消息已保存: ${userMessageId}`);
  } catch (dbError: any) {
    console.error(`[Chat] 保存用户消息失败:`, dbError);
    return res.status(500).json({ error: "保存消息失败", detail: dbError?.message });
  }

  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 智能日程管理 Agent 系统提示词
  const defaultSystemPrompt = `你是"小日程"——一个专业的AI智能日程管理助手。你的核心能力是帮助用户用自然语言快速创建、管理和规划日程。

## 核心原则
**【最重要】日程 ID 是 UUID 格式（如 "a1b2c3d4-e5f6-7890-abcd-ef1234567890"），不是数字！**
当用户说"第5个日程"、"编号5"、"第5个"时，你需要根据上下文找到对应日程的 UUID，不能随便猜一个数字！

## 你的核心能力

### 1. 自然语言任务解析
- 用户输入口语化描述时，自动提取：任务名称、时间、地点、优先级、关联事项
- 支持单天、多天、单次、重复任务解析
- 剔除无效信息，梳理清晰的任务清单

### 2. 智能自动排期
根据以下规则自动分配时间：
- **时间优先级**：优先遵循用户提及的时间（上午、下午、晚间、具体时间点）
- **任务耗时默认值**：
  - 接人/送人：30分钟
  - 会议/开会：1.5小时
  - 午餐/晚餐：1.5小时
  - 购物/办事：1小时
  - 运动/健身：1小时
  - 看医生：1-2小时
  - 约会/社交：2小时
  - 其他未分类任务：1小时
- **通勤时间**：跨地点任务自动预留30分钟通勤时间
- **作息规则**：默认工作时段 09:00-18:00，中午12:00-13:00休息

### 3. 智能追问
当信息不完整时，主动追问关键要素：
- 无具体时间 → 询问时间段（上午/下午/晚间/具体几点）
- 无地点 → 询问地点
- 任务冲突 → 提供调整建议
- 时长不明确 → 确认预计时长

### 4. 日程管理
支持的操作：
- 创建日程（包含：标题、时间、地点、分类、优先级、提醒设置）
- 查看日程（按日/周/月视图）
- 编辑日程
- 删除日程
- 标记完成/未完成
- 设置重复日程（每日/每周/每月）

## 响应格式要求

### 当用户请求创建日程时：
用友好的方式确认日程详情，格式如下：
\`\`\`
日程已创建

【任务名称】
时间：YYYY年MM月DD日 HH:MM - HH:MM
地点：[地点]
分类：[分类]
优先级：[高/中/低]
提醒：[提前X分钟]

是否需要调整？
\`\`\`

### 当需要追问时：
用口语化、友好的方式提问，不要一次性问太多问题。

### 当用户询问日程时：
清晰列出日程列表，**必须严格遵守以下格式规则**：
- 标题行（如"今天共有X项安排..."）后空一行
- **已完成** 和 **进行中 / 待办** 分类标题前后各空一行
- 每一条日程条目列举完后也要加一个空行（条目之间用空行分隔）
- 最后的总结/提醒文字前后各空一行
- 回复中禁止使用 emoji 或图标字符，保持简洁专业
- 格式示例：
  今天共有 N 项安排：\n\n**已完成**\n\n1. 事项A...\n\n2. 事项B...\n\n**进行中 / 待办**\n\n3. 事项C...\n\n总结提醒

### 当用户要修改/调整日程时：
**【关键】你必须根据对话上下文确定正确的 scheduleId（UUID 格式）！**
- 如果用户提到日程的标题或内容，用标题匹配对应的 UUID
- 不要猜测 UUID，只能使用你能从对话中确认的 ID
- 如果不确定是哪个日程，主动向用户确认

## 注意事项
- 始终使用中文回复
- 保持口语化、亲切的交流风格
- 回答简洁明了，避免冗长
- 对于模糊指令，先尝试理解意图，再确认或追问
- **日程 ID 必须是真实的 UUID，不能是数字或序号！**`;

  // 解析消息中的日期引用，获取相关日程
  function getScheduleContextForMessage(message: string): string {
    const userId = 'default';
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    
    // 计算明天、后天
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    
    const dayAfterTomorrow = new Date(now);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    const dayAfterTomorrowStr = dayAfterTomorrow.toISOString().slice(0, 10);
    
    // 计算下周（7天后）
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().slice(0, 10);
    
    // 计算下周的具体工作日
    const getNextWeekday = (targetDay: number): string => {
      const daysUntilTarget = (targetDay - now.getDay() + 7) % 7 || 7;
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + daysUntilTarget);
      return nextDate.toISOString().slice(0, 10);
    };
    const nextMonday = getNextWeekday(1);
    const nextTuesday = getNextWeekday(2);
    const nextWednesday = getNextWeekday(3);
    const nextThursday = getNextWeekday(4);
    const nextFriday = getNextWeekday(5);
    const nextSaturday = getNextWeekday(6);
    const nextSunday = getNextWeekday(0);
    
    // 解析具体日期的正则表达式
    const msgLower = message.toLowerCase();
    const msgRaw = message;
    const contexts: string[] = [];
    const processedDates = new Set<string>();
    
    // 格式化日程为文本
    const formatSchedules = (schedules: any[]) => {
      if (schedules.length === 0) return '无日程';
      return schedules.map((s, idx) => {
        const time = s.all_day ? '全天' : `${s.start_time.slice(11, 16)}${s.end_time ? ' ~ ' + s.end_time.slice(11, 16) : ''}`;
        const status = s.is_completed ? '[已完成]' : '';
        return `${idx + 1}. ${s.title} ${time} ${status} (ID:${s.id})`;
      }).join('\n');
    };
    
    // 辅助函数：添加日程上下文（避免重复）
    const addScheduleContext = (dateStr: string, label: string) => {
      if (processedDates.has(dateStr)) return;
      processedDates.add(dateStr);
      const schedules = scheduleStore.getSchedulesByDate(dateStr, userId);
      contexts.push(`【${label} (${dateStr})】\n${formatSchedules(schedules)}`);
    };
    
    // 1. 检测"明天"
    if (msgLower.includes('明天') || msgLower.includes('tomorrow')) {
      addScheduleContext(tomorrowStr, '明天');
    }
    
    // 2. 检测"后天"
    if (msgLower.includes('后天')) {
      addScheduleContext(dayAfterTomorrowStr, '后天');
    }
    
    // 3. 检测"下周X"（下周一到周日）
    if (msgLower.includes('下周一') || msgLower.includes('下星期一')) {
      addScheduleContext(nextMonday, '下周一');
    }
    if (msgLower.includes('下周二') || msgLower.includes('下星期二')) {
      addScheduleContext(nextTuesday, '下周二');
    }
    if (msgLower.includes('下周三') || msgLower.includes('下星期三')) {
      addScheduleContext(nextWednesday, '下周三');
    }
    if (msgLower.includes('下周四') || msgLower.includes('下星期四')) {
      addScheduleContext(nextThursday, '下周四');
    }
    if (msgLower.includes('下周五') || msgLower.includes('下星期五')) {
      addScheduleContext(nextFriday, '下周五');
    }
    if (msgLower.includes('周六') || msgLower.includes('星期六')) {
      addScheduleContext(nextSaturday, '周六');
    }
    if (msgLower.includes('周日') || msgLower.includes('星期天') || msgLower.includes('周日')) {
      addScheduleContext(nextSunday, '周日');
    }
    
    // 4. 检测"本周X"（本周一到周日）
    const getThisWeekday = (targetDay: number): string => {
      const daysUntilTarget = (targetDay - now.getDay() + 7) % 7;
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + daysUntilTarget);
      return targetDate.toISOString().slice(0, 10);
    };
    if (msgLower.includes('本周一') || msgLower.includes('这周一') || msgLower.includes('星期一')) {
      addScheduleContext(getThisWeekday(1), '本周一');
    }
    if (msgLower.includes('本周二') || msgLower.includes('这周二') || msgLower.includes('星期二')) {
      addScheduleContext(getThisWeekday(2), '本周二');
    }
    if (msgLower.includes('本周三') || msgLower.includes('这周三') || msgLower.includes('星期三')) {
      addScheduleContext(getThisWeekday(3), '本周三');
    }
    if (msgLower.includes('本周四') || msgLower.includes('这周四') || msgLower.includes('星期四')) {
      addScheduleContext(getThisWeekday(4), '本周四');
    }
    if (msgLower.includes('本周五') || msgLower.includes('这周五') || msgLower.includes('星期五')) {
      addScheduleContext(getThisWeekday(5), '本周五');
    }
    
    // 5. 检测"下周"（整个下周）
    if (msgLower.includes('下周') || msgLower.includes('next week')) {
      // 获取从今天到下周的所有日程
      const upcomingSchedules = scheduleStore.getSchedulesByDateRange(today, nextWeekStr, userId);
      contexts.push(`【本周及下周日程 (${today} 到 ${nextWeekStr})】\n${formatSchedules(upcomingSchedules)}`);
    }
    
    // 6. 检测"这周"、"本周"
    if (msgLower.includes('这周') || msgLower.includes('本周') || msgLower.includes('this week')) {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + (7 - now.getDay()));
      const weekEndStr = weekEnd.toISOString().slice(0, 10);
      const weekSchedules = scheduleStore.getSchedulesByDateRange(today, weekEndStr, userId);
      contexts.push(`【本周日程 (${today} 到 ${weekEndStr})】\n${formatSchedules(weekSchedules)}`);
    }
    
    // 7. 检测具体日期格式：MM月DD号、MM-DD、YYYY-MM-DD
    const monthDayPatterns = [
      /(\d{1,2})月(\d{1,2})[日号]?/g,  // 4月10号、4-10
      /(\d{1,2})-(\d{1,2})/g,           // 4-10
      /(\d{4})-(\d{1,2})-(\d{1,2})/g,   // 2026-04-10
    ];
    
    for (const pattern of monthDayPatterns) {
      let match;
      while ((match = pattern.exec(msgRaw)) !== null) {
        let year, month, day;
        if (match[3]) {
          // YYYY-MM-DD
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
        } else {
          // MM月DD号 或 MM-DD
          year = now.getFullYear();
          month = parseInt(match[1]);
          day = parseInt(match[2]);
        }
        
        // 验证日期有效性
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const targetDate = new Date(year, month - 1, day);
          const dateStr = targetDate.toISOString().slice(0, 10);
          
          // 只处理未来30天内的日期
          const daysDiff = Math.floor((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff >= -7 && daysDiff <= 60) {
            const dateLabel = `${month}月${day}日`;
            addScheduleContext(dateStr, dateLabel);
          }
        }
      }
    }
    
    // 8. 如果没有特定日期引用，默认包含今天和明天的日程
    if (contexts.length === 0) {
      const todaySchedules = scheduleStore.getSchedulesByDate(today, userId);
      const tomorrowSchedules = scheduleStore.getSchedulesByDate(tomorrowStr, userId);
      contexts.push(`【今天的日程 (${today})】\n${formatSchedules(todaySchedules)}`);
      contexts.push(`【明天的日程 (${tomorrowStr})】\n${formatSchedules(tomorrowSchedules)}`);
    }
    
    return contexts.length > 0 ? '\n\n## 用户相关日程\n' + contexts.join('\n') : '';
  }
  
  // 获取增强的系统提示词（包含日程上下文）
  function getEnhancedSystemPrompt(basePrompt: string, message: string): string {
    const scheduleContext = getScheduleContextForMessage(message);
    return basePrompt + scheduleContext;
  }
  
  // 工作目录：优先使用请求中的 cwd，否则使用当前目录
  const workingDir = cwd || process.cwd();

  try {
    console.log(`[Chat] 调用 SDK query...`);
    console.log(`[Chat] - Model: ${selectedModel}`);
    console.log(`[Chat] - Resume: ${sdkSessionId || 'none'}`);
    console.log(`[Chat] - CWD: ${workingDir}`);
    console.log(`[Chat] - PermissionMode: ${permissionMode || 'default'}`);
    
    // 创建 canUseTool 回调
    const canUseTool: CanUseTool = async (toolName, input, options) => {
      console.log(`[Permission] Tool request: ${toolName}`);
      console.log(`[Permission] Input:`, JSON.stringify(input, null, 2));
      
      // bypassPermissions 模式直接放行
      if (permissionMode === 'bypassPermissions') {
        console.log(`[Permission] Bypassing permissions for ${toolName}`);
        return { behavior: 'allow', updatedInput: input };
      }
      
      // 创建权限请求
      const requestId = uuidv4();
      const permissionRequest = {
        requestId,
        toolUseId: options.toolUseID,
        toolName,
        input,
        sessionId: session.id,
        timestamp: Date.now()
      };
      
      // 发送权限请求到前端
      res.write(`data: ${JSON.stringify({ 
        type: "permission_request", 
        ...permissionRequest
      })}\n\n`);
      
      // 创建 Promise 等待用户响应
      return new Promise<PermissionResult>((resolve, reject) => {
        const pending: PendingPermission = {
          resolve,
          reject,
          toolName,
          input,
          sessionId: session.id,
          userId,
          timestamp: Date.now()
        };
        
        pendingPermissions.set(requestId, pending);
        
        // 设置超时
        setTimeout(() => {
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId);
            console.log(`[Permission] Request timeout: ${requestId}`);
            resolve({
              behavior: 'deny',
              message: '权限请求超时'
            });
          }
        }, PERMISSION_TIMEOUT);
      });
    };
    
    // 使用 Query API 发送消息
    // 如果有 sdk_session_id，使用 resume 恢复对话上下文
    // SDK 会自动从 process.env 读取 CODEBUDDY_API_KEY
    const stream = query({
      prompt: message,
      options: {
        cwd: workingDir,
        model: selectedModel,
        maxTurns: 10,
        systemPrompt: getEnhancedSystemPrompt(systemPrompt || defaultSystemPrompt, message),
        permissionMode: permissionMode || 'default',
        canUseTool,
        env: buildCodeBuddyEnv(userCredential),
        ...(sdkSessionId ? { resume: sdkSessionId } : {})  // 使用 resume 恢复对话
      }
    });

    let fullResponse = "";
    let toolCalls: Array<{ 
      id: string; 
      name: string; 
      input?: Record<string, unknown>;
      status: string; 
      result?: string;
      isError?: boolean;
    }> = [];
    let newSdkSessionId: string | null = null;  // 用于存储 SDK 返回的 session_id

    // 发送会话ID和消息ID
    res.write(`data: ${JSON.stringify({ 
      type: "init", 
      sessionId: session.id, 
      userMessageId, 
      assistantMessageId,
      model: selectedModel 
    })}\n\n`);

    // 当前正在执行的工具 ID（用于匹配 tool_result）
    let currentToolId: string | null = null;

    // 处理流式响应
    for await (const msg of stream) {
      console.log("[Stream] Message type:", msg.type, msg);
      
      // 处理 system 消息，获取 SDK 的 session_id
      if (msg.type === "system" && (msg as any).subtype === "init") {
        newSdkSessionId = (msg as any).session_id;
        console.log(`[Stream] Got SDK session_id: ${newSdkSessionId}`);
        
        // 保存 SDK session_id 到数据库（如果是新的）
        if (newSdkSessionId && newSdkSessionId !== sdkSessionId) {
          db.updateSession(session.id, userId, { sdk_session_id: newSdkSessionId });
          console.log(`[Stream] Saved SDK session_id to database`);
        }
      } else if (msg.type === "assistant") {
        const content = msg.message.content;

        if (typeof content === "string") {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ type: "text", content })}\n\n`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              fullResponse += block.text;
              res.write(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`);
            } else if (block.type === "tool_use") {
              currentToolId = block.id || uuidv4();
              const toolInput = (block as any).input || {};
              console.log(`[Stream] Tool use: id=${currentToolId}, name=${block.name}`);
              console.log(`[Stream] Tool input:`, JSON.stringify(toolInput, null, 2));
              
              const toolCall = { 
                id: currentToolId, 
                name: block.name, 
                input: toolInput,
                status: "running" 
              };
              toolCalls.push(toolCall);
              res.write(`data: ${JSON.stringify({ 
                type: "tool", 
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
                status: toolCall.status
              })}\n\n`);
            }
          }
        }
      } else if ((msg as any).type === "tool_result") {
        // 处理工具结果（独立的消息类型）
        const msgAny = msg as any;
        const toolId = msgAny.tool_use_id || currentToolId;
        const isError = msgAny.is_error || false;
        const content = msgAny.content;
        
        console.log(`[Stream] Tool result: tool_use_id=${toolId}, is_error=${isError}`);
        console.log(`[Stream] Tool result content type:`, typeof content);
        console.log(`[Stream] Tool result content:`, typeof content === 'string' ? content.slice(0, 500) : JSON.stringify(content, null, 2)?.slice(0, 500));
        
        const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
        if (tool) {
          tool.status = isError ? "error" : "completed";
          tool.isError = isError;
          tool.result = typeof content === 'string' 
            ? content 
            : JSON.stringify(content);
          res.write(`data: ${JSON.stringify({ 
            type: "tool_result", 
            toolId: tool.id, 
            content: tool.result,
            isError: isError
          })}\n\n`);
        }
        currentToolId = null;
      } else if (msg.type === "result") {
        // 完成时确保所有工具都标记为完成
        toolCalls.forEach(tool => {
          if (tool.status === "running") {
            tool.status = "completed";
            res.write(`data: ${JSON.stringify({ type: "tool_result", toolId: tool.id, content: tool.result || "已完成" })}\n\n`);
          }
        });
        const resultMessage = msg as any;
        res.write(`data: ${JSON.stringify({ type: "done", duration: resultMessage.duration, cost: resultMessage.cost })}\n\n`);
      }
    }

    // 保存助手消息到数据库
    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content: fullResponse,
      model: selectedModel,
      created_at: new Date().toISOString(),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null
    }, userId);

    // 更新会话标题（如果是第一条消息）
    const messages = db.getMessagesBySession(session.id, userId);
    if (messages.length <= 2) {
      db.updateSession(session.id, userId, {
        title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
        model: selectedModel
      });
    }

    console.log(`[Chat] 请求完成 ✓`);
    res.end();
  } catch (error: any) {
    console.error(`\n[Chat] ========== 错误 ==========`);
    console.error(`[Chat] Error Name:`, error?.name);
    console.error(`[Chat] Error Message:`, error?.message);
    console.error(`[Chat] Error Code:`, error?.code);
    console.error(`[Chat] Error Stack:`, error?.stack);
    console.error(`[Chat] Full Error:`, JSON.stringify(error, null, 2));
    
    const errorMessage = error?.message || "处理请求时发生错误";
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
    res.end();
  }
});

// 【新增】SPA 路由支持 - 所有未匹配的路由返回 index.html
if (isProduction) {
  app.get('*', (req, res) => {
    const indexPath = path.join(staticPath, 'index.html');
    res.sendFile(indexPath);
  });
}

// 异步启动服务器（等待数据库初始化）
async function startServer() {
  try {
    // 初始化数据库
    console.log('[Startup] 初始化数据库...');
    await dbModule.initDb();
    console.log('[Startup] 数据库初始化完成');
    db = dbModule;  // 赋值给全局 db 变量

    // 初始化日程数据库
    console.log('[Startup] 初始化日程数据库...');
    await initScheduleDb();
    console.log('[Startup] 日程数据库初始化完成');

    // 初始化周期提醒数据库
    console.log('[Startup] 初始化周期提醒数据库...');
    await initReminderDb();
    console.log('[Startup] 周期提醒数据库初始化完成');

    console.log('[Startup] 初始化活动数据库...');
    await initActivityDb();
    attachmentService.attachmentsRoot();
    console.log('[Startup] 活动数据库初始化完成');
    dbInitialized = true;

    // 启动服务器
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║     ◉ API 服务器已启动                      ║
║                                            ║
║     地址: http://localhost:${PORT}            ║
║     数据库: SQLite (sql.js)                ║
║                                            ║
╚════════════════════════════════════════════╝
      `);
      // 写入启动日志，日志面板可以看到服务器状态
      addLog('info', 'system', `服务器启动成功，端口 ${PORT}`);
      addLog('info', 'system', `数据库: sql.js`);
      addLog('info', 'system', `环境: ${process.env.APP_ENV || process.env.NODE_ENV || 'development'}`);
      addLog('info', 'system', '邀请码已配置（具体值不会写入日志）');
    });
  } catch (error) {
    console.error('[Startup] 服务器启动失败:', error);
    process.exit(1);
  }
}

startServer();

// ============================================================
// 每日邮件提醒定时任务（每分钟检查一次）
// ============================================================
cron.schedule('* * * * *', () => {
  try {
    const now = new Date();
    // 北京时区（UTC+8）
    const beijingHour = parseInt(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(now));
    const beijingMinute = parseInt(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', minute: '2-digit', hour12: false }).format(now));
    const beijingDate = reminderStore.todayInTimezone('Asia/Shanghai');

    const reminders = db.getAllEnabledReminders();
    for (const reminder of reminders) {
      if (reminder.hour === beijingHour && reminder.minute === beijingMinute) {
        const schedules = scheduleStore.getSchedulesByDate(beijingDate, reminder.user_id).filter(item => !item.is_completed);
        enqueueUserNotification({
          userId: reminder.user_id,
          sourceType: 'digest',
          sourceId: beijingDate,
          kind: 'daily_digest',
          title: `今日行动提醒 · ${schedules.length} 项待处理`,
          body: schedules.length ? schedules.map(item => `${item.start_time.slice(11, 16)} ${item.title}`).join('\n') : '今天暂无未完成日程。',
          dedupePrefix: `daily:${reminder.user_id}:${beijingDate}`,
        });
      }
    }
  } catch (err) {
    console.error('[Cron] 每日提醒任务出错:', err);
  }

  processCycleReminders((message, error) => {
    if (error) addLog('error', 'reminder', message, { error: error instanceof Error ? error.message : String(error) });
    else addLog('info', 'reminder', message);
  }).catch(error => {
    addLog('error', 'reminder', '周期提醒检查失败: ' + (error?.message || error));
  });

  processNotificationQueue((message, error) => {
    if (error) addLog('error', 'reminder', message, { error: error instanceof Error ? error.message : String(error) });
    else addLog('info', 'reminder', message);
  }).catch(error => addLog('error', 'reminder', '通知队列处理失败: ' + (error?.message || error)));

  activityStore.expireAiImports();
});

cron.schedule('30 3 * * *', async () => {
  if (!dbInitialized || !process.env.BACKUP_ENCRYPTION_KEY) return;
  try {
    const backup = backupService.createSystemSnapshot(true);
    const oss = await backupService.uploadPendingSystemSnapshots();
    addLog('info', 'system', '每日系统备份完成: ' + backup.filename, { size: backup.size, oss });
  } catch (error: any) {
    addLog('error', 'system', '每日系统备份失败: ' + (error?.message || error));
  }
}, { timezone: process.env.APP_TIMEZONE || 'Asia/Shanghai' });

cron.schedule('*/30 * * * *', async () => {
  if (!dbInitialized) return;
  const result = await backupService.uploadPendingSystemSnapshots();
  if (result.uploaded || result.failed) {
    addLog(result.failed ? 'warn' : 'info', 'system', 'OSS 备份重试完成', result);
  }
});

cron.schedule('*/5 * * * *', () => {
  if (!dbInitialized || !process.env.IMAP_PASS) return;
  pollEmailImports({
    model: scheduleModel,
    resolveApiKey: userId => db.getUserApiKey(userId)?.api_key || process.env.CODEBUDDY_API_KEY || null,
    log: (message, error) => error
      ? addLog('error', 'ai', message, { error: error instanceof Error ? error.message : String(error) })
      : addLog('info', 'ai', message),
  }).catch(error => addLog('error', 'ai', '邮箱导入调度失败: ' + (error?.message || error)));
});
