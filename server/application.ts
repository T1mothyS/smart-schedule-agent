import { cleanupAiScheduleHistory } from './ai-history.js';
import { resolveAiImportCredential } from './ai-credentials.js';
import { createRetiredRouter } from './routes/retired.js';
import { createAiImportsRouter } from './routes/ai-imports.js';
import { createAiRouter } from './routes/ai.js';

import { createSchedulesRouter } from './routes/schedules.js';
import { createCaldavRouter } from './routes/caldav.js';
import { createRemindersRouter } from './routes/reminders.js';
import { createBackupsRouter } from './routes/backups.js';
import { createReportsPublishRouter } from './routes/reports-publish.js';
import { createMailAccountRouter } from './routes/mail-account.js';
import { createExportsRouter } from './routes/exports.js';
import { createCompletionsRouter } from './routes/completions.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createSuspendedTodosRouter } from './routes/suspended-todos.js';
import { createActionCenterRouter } from './routes/action-center.js';

import { createLogsRouter } from './routes/logs.js';
import { createAdminRouter } from './routes/admin.js';
import { createAccountsRouter } from './routes/accounts.js';
import { createSettingsRouter } from './routes/settings.js';

import { createReportsReadRouter } from './routes/reports-read.js';
import { createReportsPolicyRouter } from './routes/reports-policy.js';
import { createReportsTokenRouter } from './routes/reports-token.js';
import { createLibraryRouter } from './routes/library.js';
import { createNotesRouter } from './routes/notes.js';
import { createGuidesRouter } from './routes/guides.js';
import { createSearchRouter } from './routes/search.js';
import { createStoreInitializer } from './runtime/stores.js';

import { createApp, registerSpaFallback } from './app.js';
import { createAuth } from './auth.js';
import { readRuntimeConfig } from './runtime/config.js';
import { createBackgroundJobs } from './runtime/jobs.js';

import path from "path";
import { fileURLToPath } from "url";
import * as dbModule from "./db.js";

import { getEmailConfigurationSummary } from "./email-service.js";

import { DAILY_REPORT_MEDIA_ROUTE, dailyReportMediaRoot } from './daily-report-media-service.js';

import { addLog } from './log-service.js';

import { createDailyReportCloudMcpRouter } from './daily-report-cloud-mcp.js';
import { createDailyReportCloudOAuthRouter } from './daily-report-cloud-auth.js';
import { createToolsApiRouter } from './protected-tools.js';
import { createProjectEvolutionRouter } from './project-evolution.js';

// 数据库实例（等待初始化后赋值）
let db: typeof dbModule;
let dbInitialized = false;
let inviteCodesInitialized = false;
export const runtimeConfig = readRuntimeConfig();
const { isProduction, JWT_SECRET, backgroundJobsEnabled } = runtimeConfig;
export const { signUserToken, authenticate, authenticatePage, requireAdmin, setPageSessionCookie, setPageSessionFromBearer, clearPageSessionCookie } = createAuth({ secret: JWT_SECRET, isProduction, getUserById: id => db.getUserById(id) });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = createApp({
  isProduction, trustProxyHops: runtimeConfig.trustProxyHops, isReady: () => dbInitialized,
  oauthRouter: createDailyReportCloudOAuthRouter(), mcpRouter: createDailyReportCloudMcpRouter(),
  media: { route: DAILY_REPORT_MEDIA_ROUTE, root: dailyReportMediaRoot() },
  staticPath: path.resolve(__dirname, '../dist'),
  protectedTools: { root: path.resolve(__dirname, '../protected-tools'), authenticatePage, isReady: () => dbInitialized },
});

// 日志 API
app.use(createLogsRouter({ authenticate, requireAdmin }));

app.use(createSearchRouter({ authenticate }));

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(createGuidesRouter({ authenticate }));

// 日程 AI 模型配置按账号保存，避免一个用户修改后影响其他用户。
app.use(createSettingsRouter({ authenticate, JWT_SECRET }));

// 旧聊天接口允许客户端决定工作目录和工具权限，旧 AI 接口会跳过确认直接写入。
// 保留明确的 410 响应，避免旧客户端静默执行危险行为。
app.use(createRetiredRouter({ authenticate }));

app.use(createAiRouter({ authenticate }));

app.use(createAccountsRouter({ authenticate, signUserToken, setPageSessionCookie, setPageSessionFromBearer, clearPageSessionCookie }));

app.use(createToolsApiRouter({ authenticate, root: path.resolve(__dirname, '../protected-tools') }));
app.use(createProjectEvolutionRouter({ authenticate, file: path.resolve(__dirname, '../project-evolution/generated.json') }));

app.use(createAdminRouter({ authenticate, requireAdmin }));

app.use(createActionCenterRouter({ authenticate }));

app.use(createNotesRouter({ authenticate }));

// ============= Library / 知识库 MVP =============

app.use(createLibraryRouter({ authenticate }));

app.use(createSuspendedTodosRouter({ authenticate }));

app.use(createNotificationsRouter({ authenticate }));

app.use(createCompletionsRouter({ authenticate }));

app.use(createExportsRouter({ authenticate }));

app.use(createReportsTokenRouter({ authenticate }));

// 用户 QQ 邮箱配置只返回脱敏状态；授权码只在服务端加密保存，从不通过 API 返回。
app.use(createMailAccountRouter({ authenticate }));

app.use(createReportsPolicyRouter({ authenticate }));

// 登录后的日报页面只允许读取当前账号的数据。
app.use(createReportsReadRouter({ authenticate }));

app.use(createReportsPublishRouter({ authenticate }));

app.use(createBackupsRouter({ authenticate, requireAdmin }));

app.use(createRemindersRouter({ authenticate }));

app.use(createAiImportsRouter({ authenticate }));

app.use(createSchedulesRouter({ authenticate }));
app.use(createCaldavRouter({ authenticate }));

if (isProduction) registerSpaFallback(app, path.resolve(__dirname, '../dist'));

export const initializeServer = createStoreInitializer({
  config: runtimeConfig, onDatabaseReady: value => { db = value; },
  onInviteCodesReady: ready => { inviteCodesInitialized = ready; }, onReady: () => { dbInitialized = true; },
});

export const backgroundJobs = createBackgroundJobs({ isReady: () => dbInitialized, resolveAiImportCredential, cleanupAiScheduleHistory });
export function logServiceStarted() {
  addLog('info', 'system', '启动配置已记录', { event: 'service_started', pid: process.pid, nodeVersion: process.version,
    backgroundJobsEnabled, appTimezone: process.env.APP_TIMEZONE || 'Asia/Shanghai',
    email: getEmailConfigurationSummary(), inviteCodesConfigured: inviteCodesInitialized });
}
