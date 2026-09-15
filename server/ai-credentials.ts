import { unstable_v2_createSession } from '@tencent-ai/agent-sdk';
import * as dbModule from './db.js';
import { buildCodeBuddyEnv } from './codebuddy-env.js';
import { createModelService } from './model-service.js';
import * as db from './db.js';

export const defaultModel = "glm-5.1";
export const modelService = createModelService<any>({
  ttlMs: 30 * 60 * 1000,
  timeoutMs: 30 * 1000,
  onCloseError: error => console.error('[Models] 关闭 SDK Session 失败:', error),
});

export function getAvailableModels(
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

export interface ResolvedCodeBuddyCredential {
  credential: dbModule.DbUserApiKey;
  source: 'personal' | 'admin-shared';
}

export function resolveCodeBuddyCredentialInfo(userId: string): ResolvedCodeBuddyCredential | undefined {
  const personal = db.getUserApiKey(userId);
  if (personal) return { credential: personal, source: 'personal' };

  const user = db.getUserById(userId);
  if (!user?.admin_shared_api_enabled) return undefined;
  const shared = db.getAdminSharedApiKey();
  return shared ? { credential: shared, source: 'admin-shared' } : undefined;
}

export function resolveCodeBuddyCredential(userId: string): dbModule.DbUserApiKey | undefined {
  return resolveCodeBuddyCredentialInfo(userId)?.credential;
}

export function getMissingCodeBuddyCredentialMessage(userId: string): string {
  const user = db.getUserById(userId);
  return user?.admin_shared_api_enabled
    ? '管理员共享 API 暂不可用，请联系管理员配置管理员 API Key'
    : '未配置个人 API Key，请在设置中保存当前账号的凭据';
}

export function resolveAiImportCredential(userId: string): { apiKey: string; baseUrl?: string | null; model: string } | null {
  const credential = resolveCodeBuddyCredential(userId);
  return credential ? {
    apiKey: credential.api_key,
    baseUrl: credential.base_url,
    model: db.getUserPreferredModel(userId, defaultModel),
  } : null;
}
