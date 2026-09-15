import { assertNoLegacyCodeBuddyConfig } from '../codebuddy-config.js';

export function readRuntimeConfig() {
  const PORT = process.env.PORT || 3000;
  const isProduction = process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
  // JWT 配置
  function requiredProductionConfig(name: string, fallback: string): string {
    const value = process.env[name];
    if (isProduction && !value) {
      throw new Error('[Config] 生产环境缺少必需配置: ' + name);
    }
    return value || fallback;
  }

  const JWT_SECRET = requiredProductionConfig('JWT_SECRET', 'dev-only-jwt-secret');

  // 迁移期邀请码：仅用于首次初始化缺失的数据库记录；已有数据库记录不会被环境变量覆盖。
  const LEGACY_ADMIN_INVITE_CODE = process.env.ADMIN_INVITE_CODE?.trim() || (isProduction ? '' : 'dev-admin-invite');
  const LEGACY_USER_INVITE_CODE = process.env.USER_INVITE_CODE?.trim() || (isProduction ? '' : 'dev-user-invite');

  function validate(): string {
    if (isProduction) {
      if (JWT_SECRET.length < 32) throw new Error('[Config] JWT_SECRET 至少需要 32 个字符');
    }
    const rawAppUrl = process.env.APP_URL || (isProduction ? '' : `http://localhost:${PORT}/today`);
    if (!rawAppUrl) throw new Error('[Config] 生产环境缺少必需配置: APP_URL');
    let parsed: URL;
    try { parsed = new URL(rawAppUrl); }
    catch { throw new Error('[Config] APP_URL 必须是完整的 http(s) URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('[Config] APP_URL 只允许不含账号密码的 http(s) URL');
    }
    if (isProduction && parsed.protocol !== 'https:') throw new Error('[Config] 生产 APP_URL 必须使用 HTTPS');
    if (parsed.hash) throw new Error('[Config] APP_URL 不能包含 URL fragment');
    if (process.env.BACKGROUND_JOBS_ENABLED === 'true' && !process.env.SMTP_PASS?.trim()) {
      throw new Error('[Config] 启用后台任务时必须配置 SMTP_PASS');
    }
    assertNoLegacyCodeBuddyConfig(process.env);
    return parsed.toString();
  }


  return { PORT, isProduction, JWT_SECRET, LEGACY_ADMIN_INVITE_CODE, LEGACY_USER_INVITE_CODE,
    backgroundJobsEnabled: process.env.BACKGROUND_JOBS_ENABLED === 'true',
    trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0),
    initializeEnvironment() {
      process.env.APP_URL = validate();
      process.env.CODEBUDDY_INTERNET_ENVIRONMENT ||= 'internal';
    },
  };
}
export type RuntimeConfig = ReturnType<typeof readRuntimeConfig>;
