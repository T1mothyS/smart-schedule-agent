import crypto from 'node:crypto';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as db from './db.js';

const QQ_IMAP_HOST = 'imap.qq.com';
const QQ_IMAP_PORT = 993;
const MAX_USERNAME_LENGTH = 254;
const MAX_AUTH_CODE_LENGTH = 256;
const MAX_MESSAGE_LIMIT = 100;
const MAX_SNIPPET_LENGTH = 1200;
const ENCRYPTION_SALT = 'smart-schedule-agent:user-mail:v1';

export interface UserMailAccountStatus {
  configured: boolean;
  enabled: boolean;
  provider: 'qq';
  username: string | null;
  updatedAt: string | null;
  encryptionConfigured: boolean;
}

export interface UserMailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export type UserMailReadStatus = 'OK' | 'UNAVAILABLE' | 'AUTH_ERROR' | 'PARTIAL';

export interface UserMailReadResult {
  status: UserMailReadStatus;
  configured: boolean;
  enabled: boolean;
  unreadCount: number;
  messages: UserMailMessage[];
  error?: string;
}

interface ImapClient {
  connect(): Promise<unknown>;
  getMailboxLock(mailbox: string): Promise<{ release(): void }>;
  search(query: { seen?: boolean }, options?: { uid?: boolean }): Promise<number[] | false>;
  fetchAll(
    range: number[],
    query: { uid?: boolean; envelope?: boolean; source?: boolean | { maxLength?: number } },
    options?: { uid?: boolean },
  ): Promise<FetchMessageObject[]>;
  logout(): Promise<unknown>;
}

type ImapFactory = (options: Record<string, unknown>) => ImapClient;

function encryptionKey(): Buffer {
  const configured = process.env.MAIL_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error('服务器尚未配置 MAIL_CREDENTIALS_ENCRYPTION_KEY');
  return crypto.scryptSync(configured, ENCRYPTION_SALT, 32, { N: 16_384, r: 8, p: 1 });
}

function encryptAuthCode(authCode: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(authCode, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function decryptAuthCode(value: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('邮箱授权信息格式不正确');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encodedIv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('邮箱授权信息无法解密');
  }
}

function validUsername(value: string): boolean {
  return value.length <= MAX_USERNAME_LENGTH
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validAuthCode(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_AUTH_CODE_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function emptyReadResult(status: UserMailReadStatus, configured: boolean, enabled: boolean, error?: string): UserMailReadResult {
  return { status, configured, enabled, unreadCount: 0, messages: [], ...(error ? { error } : {}) };
}

export function isMailCredentialEncryptionConfigured(): boolean {
  return Boolean(process.env.MAIL_CREDENTIALS_ENCRYPTION_KEY?.trim());
}

export function getUserMailAccountStatus(userId: string): UserMailAccountStatus {
  const account = db.getUserMailAccount(userId);
  return {
    configured: Boolean(account),
    enabled: Boolean(account?.enabled),
    provider: 'qq',
    username: account?.username || null,
    updatedAt: account?.updated_at || null,
    encryptionConfigured: isMailCredentialEncryptionConfigured(),
  };
}

export function saveUserMailAccount(
  userId: string,
  input: { username?: unknown; authCode?: unknown; enabled?: unknown },
): UserMailAccountStatus {
  const existing = db.getUserMailAccount(userId);
  const username = String(input.username ?? existing?.username ?? '').trim();
  const authCode = String(input.authCode ?? '').trim();
  const enabled = input.enabled === undefined ? Boolean(existing?.enabled ?? true) : Boolean(input.enabled);
  if (!validUsername(username)) throw new Error('QQ 邮箱账号格式不正确');
  if (!isMailCredentialEncryptionConfigured()) throw new Error('服务器尚未配置邮箱凭据加密密钥');
  if (!existing && !validAuthCode(authCode)) throw new Error('首次保存必须填写 QQ 邮箱客户端授权码');
  if (authCode && !validAuthCode(authCode)) throw new Error('QQ 邮箱客户端授权码格式不正确');

  const encryptedAuthCode = authCode ? encryptAuthCode(authCode) : existing?.encrypted_auth_code;
  if (!encryptedAuthCode) throw new Error('邮箱授权码未配置');
  const now = new Date().toISOString();
  db.upsertUserMailAccount({
    id: existing?.id || crypto.randomUUID(),
    user_id: userId,
    provider: 'qq',
    username,
    encrypted_auth_code: encryptedAuthCode,
    enabled: enabled ? 1 : 0,
    created_at: existing?.created_at || now,
    updated_at: now,
  });
  return getUserMailAccountStatus(userId);
}

export function deleteUserMailAccount(userId: string): UserMailAccountStatus {
  db.deleteUserMailAccount(userId);
  return getUserMailAccountStatus(userId);
}

function cleanText(value: unknown, maxLength = MAX_SNIPPET_LENGTH): string {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

async function readUnreadWithCredentials(
  username: string,
  authCode: string,
  limit: number,
  imapFactory: ImapFactory = options => new ImapFlow(options as any),
): Promise<UserMailMessage[]> {
  const client = imapFactory({
    host: QQ_IMAP_HOST,
    port: QQ_IMAP_PORT,
    secure: true,
    auth: { user: username, pass: authCode },
    logger: false,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  });
  let lock: { release(): void } | null = null;
  try {
    await client.connect();
    lock = await client.getMailboxLock('INBOX');
    const found = await client.search({ seen: false }, { uid: true });
    const uids = Array.isArray(found) ? found.slice(-limit).reverse() : [];
    if (!uids.length) return [];
    const messages = await client.fetchAll(
      uids,
      { uid: true, envelope: true, source: { maxLength: 256 * 1024 } },
      { uid: true },
    );
    const result: UserMailMessage[] = [];
    for (const message of messages) {
      if (!message.source) continue;
      try {
        const parsed = await simpleParser(message.source);
        const from = parsed.from?.text || message.envelope?.from?.map(item => item.address || item.name || '').filter(Boolean).join(', ') || '';
        const date = parsed.date?.toISOString() || (message.internalDate instanceof Date ? message.internalDate.toISOString() : String(message.internalDate || ''));
        result.push({
          id: String(message.uid),
          subject: cleanText(parsed.subject || message.envelope?.subject || '', 500),
          from: cleanText(from, 500),
          date: cleanText(date, 80),
          snippet: cleanText(parsed.text || parsed.html || '', MAX_SNIPPET_LENGTH),
        });
      } catch {
        // 单封邮件解析失败不应暴露原始内容，也不应阻断其余摘要。
      }
    }
    return result;
  } finally {
    lock?.release();
    await client.logout().catch(() => undefined);
  }
}

function isAuthenticationError(error: unknown): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return /AUTH|LOGIN|CREDENTIAL|PASSWORD/i.test(`${code} ${message}`);
}

export async function readUserMail(userId: string, requestedLimit = 20, imapFactory?: ImapFactory): Promise<UserMailReadResult> {
  const account = db.getUserMailAccount(userId);
  if (!account) return emptyReadResult('UNAVAILABLE', false, false, '尚未配置 QQ 邮箱');
  if (!account.enabled) return emptyReadResult('UNAVAILABLE', true, false, 'QQ 邮箱读取未启用');
  if (!isMailCredentialEncryptionConfigured()) {
    return emptyReadResult('UNAVAILABLE', true, true, '服务器尚未配置邮箱凭据加密密钥');
  }
  const limit = Math.min(Math.max(Math.floor(requestedLimit) || 20, 1), MAX_MESSAGE_LIMIT);
  try {
    const authCode = decryptAuthCode(account.encrypted_auth_code);
    const messages = await readUnreadWithCredentials(account.username, authCode, limit, imapFactory);
    return { status: 'OK', configured: true, enabled: true, unreadCount: messages.length, messages };
  } catch (error) {
    return emptyReadResult(
      isAuthenticationError(error) ? 'AUTH_ERROR' : 'UNAVAILABLE',
      true,
      true,
      isAuthenticationError(error) ? 'QQ 邮箱认证失败，请检查客户端授权码' : 'QQ 邮箱连接或读取失败',
    );
  }
}
