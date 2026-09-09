import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import * as db from './db.js';

export const DAILY_REPORT_CLOUD_RESOURCE_PATH = '/mcp';
export const DAILY_REPORT_CLOUD_MCP_PROTOCOL_VERSION = '2025-06-18';
export const DAILY_REPORT_CLOUD_SCOPES = [
  'daily_report:read_calendar',
  'daily_report:read_mail',
  'daily_report:read_context',
  'daily_report:read_history',
  'daily_report:publish',
  'offline_access',
] as const;

// 人工登录和权限审阅可能跨越多个页面；请求本身不产生令牌，完成后仍需短时授权码交换。
export const DAILY_REPORT_CLOUD_AUTHORIZATION_REQUEST_TTL_SECONDS = 30 * 60;

export type DailyReportCloudScope = typeof DAILY_REPORT_CLOUD_SCOPES[number];

const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const CLIENT_NAME_MAX_LENGTH = 100;
const MAX_REDIRECT_URIS = 10;
const TOKEN_VALUE_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/;

export interface OAuthBearerContext {
  userId: string;
  clientId: string;
  scopes: DailyReportCloudScope[];
  resource: string;
}

export interface OAuthTokenResponse {
  token_type: 'Bearer';
  access_token: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

export class DailyReportCloudOAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'DailyReportCloudOAuthError';
    this.code = code;
    this.status = status;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isoAfter(seconds: number): string {
  return new Date((nowSeconds() + seconds) * 1000).toISOString();
}

function appOrigin(): string {
  try {
    const parsed = new URL(String(process.env.APP_URL || 'http://localhost:3000'));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      throw new Error('invalid APP_URL');
    }
    return parsed.origin;
  } catch {
    return 'http://localhost:3000';
  }
}

export function dailyReportCloudIssuer(): string {
  return appOrigin();
}

export function dailyReportCloudResource(): string {
  return `${appOrigin()}${DAILY_REPORT_CLOUD_RESOURCE_PATH}`;
}

export function dailyReportCloudMetadata() {
  const issuer = dailyReportCloudIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...DAILY_REPORT_CLOUD_SCOPES],
  };
}

export function dailyReportCloudProtectedResourceMetadata() {
  return {
    resource: dailyReportCloudResource(),
    authorization_servers: [dailyReportCloudIssuer()],
    bearer_methods_supported: ['header'],
    scopes_supported: [...DAILY_REPORT_CLOUD_SCOPES],
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseScopes(value: unknown, required = true): DailyReportCloudScope[] {
  const raw = asString(value).trim();
  if (!raw && !required) return [];
  const values = [...new Set(raw.split(/\s+/).filter(Boolean))];
  if (!values.length) throw new DailyReportCloudOAuthError('invalid_scope', 'scope 不能为空');
  if (values.length > DAILY_REPORT_CLOUD_SCOPES.length) {
    throw new DailyReportCloudOAuthError('invalid_scope', 'scope 数量超出限制');
  }
  for (const scope of values) {
    if (!(DAILY_REPORT_CLOUD_SCOPES as readonly string[]).includes(scope)) {
      throw new DailyReportCloudOAuthError('invalid_scope', '请求了不受支持的 scope');
    }
  }
  return values as DailyReportCloudScope[];
}

function serializeScopes(scopes: readonly string[]): string {
  return [...new Set(scopes)].join(' ');
}

function parseJsonArray(value: string, field: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error('not array');
    return parsed.map(item => String(item));
  } catch {
    throw new DailyReportCloudOAuthError('invalid_request', `${field} 配置无效`);
  }
}

function validRedirectUri(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) throw new DailyReportCloudOAuthError('invalid_redirect_uri', 'redirect_uri 无效');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new DailyReportCloudOAuthError('invalid_redirect_uri', 'redirect_uri 无效'); }
  if (parsed.username || parsed.password || parsed.hash || !parsed.hostname) {
    throw new DailyReportCloudOAuthError('invalid_redirect_uri', 'redirect_uri 不允许账号、密码或 fragment');
  }
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname.toLowerCase());
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
    throw new DailyReportCloudOAuthError('invalid_redirect_uri', 'redirect_uri 必须使用 HTTPS（本机回调可使用 localhost）');
  }
  return raw;
}

function redirectUriFromClient(client: db.DbOAuthClient, value: unknown): string {
  const redirectUri = validRedirectUri(value);
  const registered = parseJsonArray(client.redirect_uris_json, 'redirect_uris');
  if (!registered.includes(redirectUri)) {
    throw new DailyReportCloudOAuthError('invalid_request', 'redirect_uri 与已注册地址不匹配');
  }
  return redirectUri;
}

function clientFromId(value: unknown): db.DbOAuthClient {
  const clientId = asString(value).trim();
  if (!clientId || clientId.length > 200) throw new DailyReportCloudOAuthError('invalid_client', 'client_id 无效', 401);
  const client = db.getOAuthClient(clientId);
  if (!client) throw new DailyReportCloudOAuthError('invalid_client', 'client_id 无效', 401);
  if (client.token_endpoint_auth_method !== 'none') {
    throw new DailyReportCloudOAuthError('invalid_client', '客户端认证方式不受支持', 401);
  }
  return client;
}

function resourceFromValue(value: unknown): string {
  const resource = asString(value).trim();
  if (resource && resource !== dailyReportCloudResource()) {
    throw new DailyReportCloudOAuthError('invalid_target', 'resource 与 MCP 服务地址不匹配');
  }
  return dailyReportCloudResource();
}

function assertCodeChallenge(value: unknown, method: unknown): { value: string; method: 'S256' } {
  const challenge = asString(value).trim();
  const challengeMethod = asString(method).trim();
  if (challengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    throw new DailyReportCloudOAuthError('invalid_request', '必须使用 S256 PKCE code_challenge');
  }
  return { value: challenge, method: 'S256' };
}

function assertState(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const state = asString(value);
  if (!state || state.length > 2048 || /[\u0000-\u001f\u007f]/.test(state)) {
    throw new DailyReportCloudOAuthError('invalid_request', 'state 无效');
  }
  return state;
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function parseClientJson(client: db.DbOAuthClient): { redirectUris: string[]; grantTypes: string[]; responseTypes: string[] } {
  return {
    redirectUris: parseJsonArray(client.redirect_uris_json, 'redirect_uris'),
    grantTypes: parseJsonArray(client.grant_types_json, 'grant_types'),
    responseTypes: parseJsonArray(client.response_types_json, 'response_types'),
  };
}

export function registerDailyReportCloudClient(input: unknown): Record<string, unknown> {
  const body = jsonObject(input);
  const clientName = asString(body.client_name).trim();
  if (!clientName || clientName.length > CLIENT_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(clientName)) {
    throw new DailyReportCloudOAuthError('invalid_client_metadata', 'client_name 无效');
  }
  const rawUris = body.redirect_uris;
  if (!Array.isArray(rawUris) || rawUris.length < 1 || rawUris.length > MAX_REDIRECT_URIS) {
    throw new DailyReportCloudOAuthError('invalid_client_metadata', 'redirect_uris 数量无效');
  }
  const redirectUris = [...new Set(rawUris.map(validRedirectUri))];
  const grantTypes = body.grant_types === undefined
    ? ['authorization_code', 'refresh_token']
    : Array.isArray(body.grant_types) ? body.grant_types.map(item => String(item)) : [];
  const responseTypes = body.response_types === undefined
    ? ['code']
    : Array.isArray(body.response_types) ? body.response_types.map(item => String(item)) : [];
  if (!grantTypes.includes('authorization_code') || grantTypes.some(item => !['authorization_code', 'refresh_token'].includes(item))) {
    throw new DailyReportCloudOAuthError('invalid_client_metadata', 'grant_types 只支持 authorization_code 和 refresh_token');
  }
  if (responseTypes.length !== 1 || responseTypes[0] !== 'code') {
    throw new DailyReportCloudOAuthError('invalid_client_metadata', 'response_types 只支持 code');
  }
  const authMethod = body.token_endpoint_auth_method === undefined ? 'none' : asString(body.token_endpoint_auth_method);
  if (authMethod !== 'none') throw new DailyReportCloudOAuthError('invalid_client_metadata', '只支持公开客户端 PKCE');

  const clientId = `drc_${crypto.randomBytes(18).toString('base64url')}`;
  const now = new Date().toISOString();
  const client = db.createOAuthClient({
    client_id: clientId,
    client_name: clientName,
    redirect_uris_json: JSON.stringify(redirectUris),
    grant_types_json: JSON.stringify([...new Set(grantTypes)]),
    response_types_json: JSON.stringify(responseTypes),
    token_endpoint_auth_method: 'none',
    created_at: now,
    updated_at: now,
  });
  return {
    client_id: client.client_id,
    client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
    client_name: client.client_name,
    redirect_uris: redirectUris,
    grant_types: [...new Set(grantTypes)],
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
  };
}

function authorizationRequestFromInput(input: Record<string, unknown>): {
  client: db.DbOAuthClient;
  redirectUri: string;
  scopes: DailyReportCloudScope[];
  state: string | null;
  codeChallenge: string;
  resource: string;
} {
  const responseType = asString(input.response_type).trim();
  if (responseType !== 'code') throw new DailyReportCloudOAuthError('unsupported_response_type', 'response_type 只支持 code');
  const client = clientFromId(input.client_id);
  const clientJson = parseClientJson(client);
  if (!clientJson.responseTypes.includes('code') || !clientJson.grantTypes.includes('authorization_code')) {
    throw new DailyReportCloudOAuthError('unauthorized_client', '客户端未注册 authorization_code');
  }
  const redirectUri = redirectUriFromClient(client, input.redirect_uri);
  const scopes = parseScopes(input.scope);
  const state = assertState(input.state);
  const challenge = assertCodeChallenge(input.code_challenge, input.code_challenge_method);
  const resource = resourceFromValue(input.resource);
  return { client, redirectUri, scopes, state, codeChallenge: challenge.value, resource };
}

export function createDailyReportCloudAuthorizationRequest(input: unknown): {
  requestId: string;
  csrfToken: string;
  clientName: string;
  redirectUri: string;
  scopes: DailyReportCloudScope[];
  state: string | null;
} {
  const normalized = authorizationRequestFromInput(jsonObject(input));
  const requestId = crypto.randomUUID();
  const csrfToken = randomToken();
  const now = new Date().toISOString();
  db.createOAuthAuthorizationRequest({
    id: requestId,
    client_id: normalized.client.client_id,
    redirect_uri: normalized.redirectUri,
    scope: serializeScopes(normalized.scopes),
    state: normalized.state,
    code_challenge: normalized.codeChallenge,
    code_challenge_method: 'S256',
    resource: normalized.resource,
    csrf_hash: hashValue(csrfToken),
    user_id: null,
    expires_at: isoAfter(DAILY_REPORT_CLOUD_AUTHORIZATION_REQUEST_TTL_SECONDS),
    created_at: now,
  });
  return {
    requestId,
    csrfToken,
    clientName: normalized.client.client_name,
    redirectUri: normalized.redirectUri,
    scopes: normalized.scopes,
    state: normalized.state,
  };
}

function assertRequestUsable(requestId: string, csrfToken: string): db.DbOAuthAuthorizationRequest {
  const request = db.getOAuthAuthorizationRequest(requestId);
  if (!request || Date.parse(request.expires_at) <= Date.now()) {
    throw new DailyReportCloudOAuthError('invalid_request', '授权请求已过期，请重新开始');
  }
  if (!safeEqual(request.csrf_hash, hashValue(csrfToken))) {
    throw new DailyReportCloudOAuthError('invalid_request', '授权请求校验失败');
  }
  return request;
}

export function completeDailyReportCloudLogin(requestId: string, csrfToken: string, email: string, password: string): boolean {
  const request = assertRequestUsable(requestId, csrfToken);
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 254 || password.length > 1_000) return false;
  const user = db.getUserByEmail(normalizedEmail);
  if (!user || user.disabled) return false;
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return false;
  db.setOAuthAuthorizationRequestUser(request.id, user.id);
  db.updateUserLastLogin(user.id);
  return true;
}

export function approveDailyReportCloudAuthorization(requestId: string, csrfToken: string, approved: boolean): string {
  const request = assertRequestUsable(requestId, csrfToken);
  const state = request.state;
  const redirect = new URL(request.redirect_uri);
  if (!approved) {
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', '用户拒绝了日报云端访问');
    if (state) redirect.searchParams.set('state', state);
    db.deleteOAuthAuthorizationRequest(request.id);
    return redirect.toString();
  }
  if (!request.user_id) throw new DailyReportCloudOAuthError('access_denied', '请先完成账号登录');
  const user = db.getUserById(request.user_id);
  if (!user || user.disabled) throw new DailyReportCloudOAuthError('access_denied', '当前账号不可用于日报云端授权');
  const rawCode = randomToken();
  db.createOAuthAuthorizationCode({
    code_hash: hashValue(rawCode),
    client_id: request.client_id,
    user_id: request.user_id,
    redirect_uri: request.redirect_uri,
    scope: request.scope,
    code_challenge: request.code_challenge,
    code_challenge_method: request.code_challenge_method,
    resource: request.resource,
    expires_at: isoAfter(AUTHORIZATION_CODE_TTL_SECONDS),
    created_at: new Date().toISOString(),
    used_at: null,
  });
  redirect.searchParams.set('code', rawCode);
  if (state) redirect.searchParams.set('state', state);
  db.deleteOAuthAuthorizationRequest(request.id);
  return redirect.toString();
}

function assertTokenValue(value: unknown, field: string): string {
  const token = asString(value).trim();
  if (!TOKEN_VALUE_PATTERN.test(token)) throw new DailyReportCloudOAuthError('invalid_grant', `${field} 无效`);
  return token;
}

function verifyPkce(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(verifier)) return false;
  const calculated = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return safeEqual(calculated, challenge);
}

function issueTokens(
  clientId: string,
  userId: string,
  scopes: DailyReportCloudScope[],
  resource: string,
  includeRefresh: boolean,
  familyId: string = crypto.randomUUID(),
): OAuthTokenResponse {
  const scope = serializeScopes(scopes);
  const now = new Date().toISOString();
  const accessToken = randomToken();
  db.createOAuthAccessToken({
    token_hash: hashValue(accessToken),
    client_id: clientId,
    user_id: userId,
    scope,
    resource,
    expires_at: isoAfter(ACCESS_TOKEN_TTL_SECONDS),
    created_at: now,
    last_used_at: null,
    revoked_at: null,
  });
  const response: OAuthTokenResponse = {
    token_type: 'Bearer',
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope,
  };
  if (includeRefresh) {
    const refreshToken = randomToken();
    db.createOAuthRefreshToken({
      token_hash: hashValue(refreshToken),
      family_id: familyId,
      client_id: clientId,
      user_id: userId,
      scope,
      resource,
      expires_at: isoAfter(REFRESH_TOKEN_TTL_SECONDS),
      created_at: now,
      last_used_at: null,
      revoked_at: null,
      rotated_at: null,
    });
    response.refresh_token = refreshToken;
  }
  return response;
}

export function exchangeDailyReportCloudAuthorizationCode(input: unknown): OAuthTokenResponse {
  const body = jsonObject(input);
  if (asString(body.grant_type) !== 'authorization_code') {
    throw new DailyReportCloudOAuthError('unsupported_grant_type', '只支持 authorization_code');
  }
  const client = clientFromId(body.client_id);
  if (body.client_secret !== undefined) throw new DailyReportCloudOAuthError('invalid_client', '公开客户端不应发送 client_secret', 401);
  const row = db.getOAuthAuthorizationCode(hashValue(assertTokenValue(body.code, 'code')));
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) {
    throw new DailyReportCloudOAuthError('invalid_grant', 'authorization code 无效或已使用');
  }
  if (row.client_id !== client.client_id || row.redirect_uri !== asString(body.redirect_uri)) {
    throw new DailyReportCloudOAuthError('invalid_grant', 'authorization code 与客户端不匹配');
  }
  if (resourceFromValue(body.resource) !== row.resource) {
    throw new DailyReportCloudOAuthError('invalid_grant', 'resource 与授权不匹配');
  }
  const user = db.getUserById(row.user_id);
  if (!user || user.disabled) throw new DailyReportCloudOAuthError('invalid_grant', '当前账号不可用于日报云端授权');
  if (!verifyPkce(asString(body.code_verifier), row.code_challenge)) {
    throw new DailyReportCloudOAuthError('invalid_grant', 'PKCE 校验失败');
  }
  const scopes = parseScopes(row.scope);
  const clientJson = parseClientJson(client);
  const includeRefresh = scopes.includes('offline_access');
  if (includeRefresh && !clientJson.grantTypes.includes('refresh_token')) {
    throw new DailyReportCloudOAuthError('unauthorized_client', '客户端未注册 refresh_token');
  }
  if (!db.markOAuthAuthorizationCodeUsed(row.code_hash)) {
    throw new DailyReportCloudOAuthError('invalid_grant', 'authorization code 已使用');
  }
  return issueTokens(client.client_id, row.user_id, scopes, row.resource, includeRefresh);
}

export function refreshDailyReportCloudAccessToken(input: unknown): OAuthTokenResponse {
  const body = jsonObject(input);
  if (asString(body.grant_type) !== 'refresh_token') {
    throw new DailyReportCloudOAuthError('unsupported_grant_type', '只支持 refresh_token');
  }
  const client = clientFromId(body.client_id);
  if (body.client_secret !== undefined) throw new DailyReportCloudOAuthError('invalid_client', '公开客户端不应发送 client_secret', 401);
  const rawRefresh = assertTokenValue(body.refresh_token, 'refresh_token');
  const row = db.getOAuthRefreshToken(hashValue(rawRefresh));
  if (!row || row.client_id !== client.client_id) throw new DailyReportCloudOAuthError('invalid_grant', 'refresh_token 无效');
  const user = db.getUserById(row.user_id);
  if (!user || user.disabled) {
    db.revokeOAuthRefreshFamily(row.family_id);
    throw new DailyReportCloudOAuthError('invalid_grant', '当前账号不可用于日报云端授权');
  }
  if (row.revoked_at) {
    // 轮换令牌重放视为令牌族泄露，撤销同一 family 的其余令牌。
    db.revokeOAuthRefreshFamily(row.family_id);
    throw new DailyReportCloudOAuthError('invalid_grant', 'refresh_token 已被轮换或撤销');
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.revokeOAuthRefreshToken(row.token_hash);
    throw new DailyReportCloudOAuthError('invalid_grant', 'refresh_token 已过期');
  }
  if (resourceFromValue(body.resource) !== row.resource) throw new DailyReportCloudOAuthError('invalid_grant', 'resource 与授权不匹配');
  const originalScopes = parseScopes(row.scope);
  const requestedScopes = body.scope === undefined ? originalScopes : parseScopes(body.scope);
  if (requestedScopes.some(scope => !originalScopes.includes(scope))) {
    throw new DailyReportCloudOAuthError('invalid_scope', '不能扩大 refresh_token 的授权范围');
  }
  if (!db.rotateOAuthRefreshToken(row.token_hash)) {
    throw new DailyReportCloudOAuthError('invalid_grant', 'refresh_token 已被轮换');
  }
  return issueTokens(client.client_id, row.user_id, requestedScopes, row.resource, requestedScopes.includes('offline_access'), row.family_id);
}

export function revokeDailyReportCloudToken(rawToken: unknown): void {
  const token = asString(rawToken).trim();
  if (!token || token.length > 512) return;
  const hash = hashValue(token);
  db.revokeOAuthAccessToken(hash);
  db.revokeOAuthRefreshToken(hash);
}

export function authenticateDailyReportCloudAccessToken(
  rawToken: unknown,
  requiredScopes: readonly DailyReportCloudScope[] = [],
): OAuthBearerContext | null {
  const token = asString(rawToken).trim();
  if (!TOKEN_VALUE_PATTERN.test(token)) return null;
  const hash = hashValue(token);
  const row = db.getActiveOAuthAccessToken(hash);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now() || row.resource !== dailyReportCloudResource()) {
    db.revokeOAuthAccessToken(hash);
    return null;
  }
  const user = db.getUserById(row.user_id);
  if (!user || user.disabled) {
    db.revokeOAuthAccessToken(hash);
    return null;
  }
  const scopes = parseScopes(row.scope);
  if (requiredScopes.some(scope => !scopes.includes(scope))) return null;
  db.markOAuthAccessTokenUsed(hash);
  return { userId: row.user_id, clientId: row.client_id, scopes, resource: row.resource };
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

const SCOPE_LABELS: Record<string, string> = {
  'daily_report:read_calendar': '读取今天及明天的日程',
  'daily_report:read_mail': '读取 QQ 邮箱未读摘要（不读取授权码）',
  'daily_report:read_context': '读取日报 Context 和活动证据',
  'daily_report:read_history': '读取最近日报的去重摘要',
  'daily_report:publish': '发布日报并按账号设置排队邮件',
  offline_access: '允许定时任务在登录后持续刷新授权',
};

function renderShell(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7fb;color:#182230;margin:0;padding:32px}.card{max-width:560px;margin:8vh auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;box-shadow:0 12px 40px #10182812}h1{font-size:22px;margin:0 0 12px}p{line-height:1.6;color:#475467}.muted{font-size:13px;color:#667085}.error{background:#fff1f0;color:#b42318;border-radius:8px;padding:10px 12px;margin:12px 0}label{display:block;font-size:14px;font-weight:600;margin:14px 0 6px}input{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #d0d5dd;border-radius:8px;font-size:15px}button{border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer;background:#175cd3;color:white}button.secondary{background:#eef2f6;color:#344054;margin-left:8px}.actions{display:flex;justify-content:flex-end;margin-top:22px}ul{padding-left:22px;line-height:1.8}</style></head><body><main class="card">${body}</main></body></html>`;
}

function renderLogin(request: { requestId: string; csrfToken: string; clientName: string }, error = ''): string {
  return renderShell('日报云端授权', `<h1>登录以连接日报云端</h1><p><strong>${htmlEscape(request.clientName)}</strong> 请求访问 AI Calendar 的日报云端接口。</p>${error ? `<div class="error">${htmlEscape(error)}</div>` : ''}<form method="post" action="/oauth/authorize/login"><input type="hidden" name="request_id" value="${htmlEscape(request.requestId)}"><input type="hidden" name="csrf" value="${htmlEscape(request.csrfToken)}"><label for="email">账号邮箱</label><input id="email" name="email" type="email" autocomplete="username" required><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><div class="actions"><button type="submit">继续授权</button></div></form><p class="muted">密码只用于本次服务端登录校验，不会传给 ChatGPT Work，也不会写入日报。</p>`);
}

function renderConsent(request: db.DbOAuthAuthorizationRequest, email: string, csrfToken: string): string {
  const scopes = parseScopes(request.scope);
  const items = scopes.map(scope => `<li>${htmlEscape(SCOPE_LABELS[scope] || scope)}</li>`).join('');
  return renderShell('确认日报云端授权', `<h1>确认日报云端授权</h1><p>当前账号：<strong>${htmlEscape(email)}</strong></p><p>ChatGPT Work 将获得以下权限：</p><ul>${items}</ul><form method="post" action="/oauth/authorize/consent"><input type="hidden" name="request_id" value="${htmlEscape(request.id)}"><input type="hidden" name="csrf" value="${htmlEscape(csrfToken)}"><div class="actions"><button class="secondary" name="approved" value="false" type="submit">拒绝</button><button name="approved" value="true" type="submit">允许连接</button></div></form><p class="muted">可通过 OAuth 撤销接口使该连接的令牌失效；日报邮件仍遵循账号自己的通知设置。</p>`);
}

function oauthErrorResponse(res: express.Response, error: unknown): void {
  const oauthError = error instanceof DailyReportCloudOAuthError
    ? error
    : new DailyReportCloudOAuthError('server_error', 'OAuth 服务暂时不可用', 500);
  res.status(oauthError.status).setHeader('Cache-Control', 'no-store').json({
    error: oauthError.code,
    error_description: oauthError.message,
  });
}

export function createDailyReportCloudOAuthRouter(): express.Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '32kb' }));

  const protectedResourcePaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ];
  const authorizationServerPaths = [
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
  ];
  router.get(protectedResourcePaths, (_req, res) => res.setHeader('Cache-Control', 'no-store').json(dailyReportCloudProtectedResourceMetadata()));
  router.get(authorizationServerPaths, (_req, res) => res.setHeader('Cache-Control', 'no-store').json(dailyReportCloudMetadata()));

  router.post('/oauth/register', (req, res) => {
    try {
      res.status(201).setHeader('Cache-Control', 'no-store').json(registerDailyReportCloudClient(req.body));
    } catch (error) {
      oauthErrorResponse(res, error);
    }
  });

  router.get('/oauth/authorize', (req, res) => {
    try {
      const request = createDailyReportCloudAuthorizationRequest(req.query);
      res.setHeader('Cache-Control', 'no-store').type('html').send(renderLogin(request));
    } catch (error) {
      oauthErrorResponse(res, error);
    }
  });

  router.post('/oauth/authorize/login', (req, res) => {
    const requestId = asString(req.body?.request_id);
    const csrf = asString(req.body?.csrf);
    try {
      const request = db.getOAuthAuthorizationRequest(requestId);
      if (!request) throw new DailyReportCloudOAuthError('invalid_request', '授权请求不存在或已过期');
      const client = db.getOAuthClient(request.client_id);
      if (!client) throw new DailyReportCloudOAuthError('invalid_request', '授权客户端不存在');
      if (!completeDailyReportCloudLogin(requestId, csrf, asString(req.body?.email), asString(req.body?.password))) {
        return res.status(401).setHeader('Cache-Control', 'no-store').type('html').send(renderLogin({ requestId, csrfToken: csrf, clientName: client.client_name }, '邮箱或密码错误'));
      }
      const updated = db.getOAuthAuthorizationRequest(requestId);
      if (!updated?.user_id) throw new DailyReportCloudOAuthError('access_denied', '账号登录未完成');
      res.setHeader('Cache-Control', 'no-store').type('html').send(renderConsent(updated, asString(req.body?.email).trim().toLowerCase(), csrf));
    } catch (error) {
      oauthErrorResponse(res, error);
    }
  });

  router.post('/oauth/authorize/consent', (req, res) => {
    try {
      const approved = asString(req.body?.approved).toLowerCase() === 'true';
      const redirectUri = approveDailyReportCloudAuthorization(asString(req.body?.request_id), asString(req.body?.csrf), approved);
      res.redirect(302, redirectUri);
    } catch (error) {
      oauthErrorResponse(res, error);
    }
  });

  router.post('/oauth/token', (req, res) => {
    try {
      const body = req.body || {};
      const grantType = asString(body.grant_type);
      const result = grantType === 'authorization_code'
        ? exchangeDailyReportCloudAuthorizationCode(body)
        : grantType === 'refresh_token'
          ? refreshDailyReportCloudAccessToken(body)
          : (() => { throw new DailyReportCloudOAuthError('unsupported_grant_type', 'grant_type 不受支持'); })();
      res.setHeader('Cache-Control', 'no-store').setHeader('Pragma', 'no-cache').json(result);
    } catch (error) {
      oauthErrorResponse(res, error);
    }
  });

  router.post('/oauth/revoke', (req, res) => {
    revokeDailyReportCloudToken(req.body?.token);
    res.status(200).setHeader('Cache-Control', 'no-store').json({});
  });

  return router;
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  const match = String(authorizationHeader || '').match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}
