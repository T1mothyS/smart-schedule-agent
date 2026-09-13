import crypto from 'node:crypto';
import * as db from './db.js';

export type InviteRole = 'admin' | 'user';

const INVITE_ROLES: readonly InviteRole[] = ['admin', 'user'];
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;

export interface InviteCodeStatus {
  role: InviteRole;
  active: boolean;
  createdAt: string | null;
  rotatedAt: string | null;
  version: number | null;
}

export interface InviteCodeRotation {
  role: InviteRole;
  code: string;
  status: InviteCodeStatus;
}

interface InitializeInviteCodesOptions {
  adminCode?: string;
  userCode?: string;
  isProduction: boolean;
}

function normalizeInviteCode(value: unknown): string {
  return String(value ?? '').trim();
}

function isInviteRole(value: string): value is InviteRole {
  return (INVITE_ROLES as readonly string[]).includes(value);
}

function roleConfigName(role: InviteRole): string {
  return role === 'admin' ? 'ADMIN_INVITE_CODE' : 'USER_INVITE_CODE';
}

function assertInviteRole(value: string): asserts value is InviteRole {
  if (!isInviteRole(value)) throw new Error('邀请码角色必须是 admin 或 user');
}

function encodeHash(salt: Buffer, derivedKey: Buffer): string {
  return `scrypt-v1$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

/** 只保存不可逆哈希；每次哈希使用独立随机盐。 */
export function hashInviteCode(value: string): string {
  const code = normalizeInviteCode(value);
  if (!code) throw new Error('邀请码不能为空');
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(code, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return encodeHash(salt, derivedKey);
}

export function verifyInviteCode(value: string, encodedHash: string): boolean {
  const code = normalizeInviteCode(value);
  if (!code || typeof encodedHash !== 'string') return false;
  const parts = encodedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt-v1') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    if (salt.length === 0 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = crypto.scryptSync(code, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function toStatus(row: db.DbInviteCode | undefined, role: InviteRole): InviteCodeStatus {
  return row
    ? {
        role,
        active: true,
        createdAt: row.created_at,
        rotatedAt: row.rotated_at,
        version: Number(row.version),
      }
    : {
        role,
        active: false,
        createdAt: null,
        rotatedAt: null,
        version: null,
      };
}

export function listInviteCodeStatuses(): InviteCodeStatus[] {
  return INVITE_ROLES.map(role => toStatus(db.getInviteCode(role), role));
}

/**
 * 在数据库迁移完成后执行一次：已有记录优先，只有缺失角色才读取迁移期环境变量。
 * 因此数据库初始化完成后，环境变量不会覆盖已轮换的邀请码。
 */
export function initializeInviteCodes(options: InitializeInviteCodesOptions): InviteCodeStatus[] {
  const legacyCodes: Record<InviteRole, string> = {
    admin: normalizeInviteCode(options.adminCode),
    user: normalizeInviteCode(options.userCode),
  };

  const existingRows: Record<InviteRole, db.DbInviteCode | undefined> = {
    admin: db.getInviteCode('admin'),
    user: db.getInviteCode('user'),
  };
  const missingRoles = INVITE_ROLES.filter(role => !existingRows[role]);

  if (options.isProduction && missingRoles.length === INVITE_ROLES.length && legacyCodes.admin && legacyCodes.admin === legacyCodes.user) {
    throw new Error('[Config] 管理员邀请码和普通用户邀请码不能相同');
  }

  for (const role of missingRoles) {
    const legacyCode = legacyCodes[role];
    if (!legacyCode) {
      throw new Error(`[Config] 缺少邀请码初始化配置: ${roleConfigName(role)}`);
    }
    if (options.isProduction && legacyCode.length < 12) {
      throw new Error('[Config] 生产邀请码至少需要 12 个字符');
    }
    const otherRole = role === 'admin' ? 'user' : 'admin';
    const otherRow = existingRows[otherRole];
    if (options.isProduction && otherRow && verifyInviteCode(legacyCode, otherRow.code_hash)) {
      throw new Error('[Config] 管理员邀请码和普通用户邀请码不能相同');
    }
    const now = new Date().toISOString();
    db.upsertInviteCode({
      role,
      code_hash: hashInviteCode(legacyCode),
      created_at: now,
      rotated_at: now,
      version: 1,
    });
  }

  const statuses = listInviteCodeStatuses();
  if (options.isProduction && statuses.some(status => !status.active)) {
    throw new Error('[Config] 生产环境邀请码初始化不完整');
  }
  return statuses;
}

export function getInviteCodeRole(value: string): InviteRole | null {
  const code = normalizeInviteCode(value);
  if (!code) return null;
  for (const role of INVITE_ROLES) {
    const row = db.getInviteCode(role);
    if (row && verifyInviteCode(code, row.code_hash)) return role;
  }
  return null;
}

function generateInviteCode(role: InviteRole): string {
  return `aic_${role}_${crypto.randomBytes(32).toString('base64url')}`;
}

function codeAlreadyStored(code: string): boolean {
  return INVITE_ROLES.some(role => {
    const row = db.getInviteCode(role);
    return Boolean(row && verifyInviteCode(code, row.code_hash));
  });
}

export function rotateInviteCode(value: string): InviteCodeRotation {
  assertInviteRole(value);
  const current = db.getInviteCode(value);
  if (!current) throw new Error('邀请码尚未初始化，无法轮换');

  let code = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateInviteCode(value);
    if (!codeAlreadyStored(candidate)) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error('生成新邀请码失败，请稍后重试');

  const rotatedAt = new Date().toISOString();
  const row = db.upsertInviteCode({
    role: value,
    code_hash: hashInviteCode(code),
    created_at: current.created_at,
    rotated_at: rotatedAt,
    version: Number(current.version || 0) + 1,
  });
  return { role: value, code, status: toStatus(row, value) };
}
