import { queryAll, queryOne, run } from '../connection.js';
import type { DbUser, DbInviteCode, DbEmailCode, PublicDbUser } from '../types.js';
import crypto from 'node:crypto';

export function getAllUsers(): PublicDbUser[] {
  const users = queryAll<any>('SELECT id, email, role, disabled, admin_shared_api_enabled, created_at, updated_at, last_login_at FROM users ORDER BY created_at DESC');
  return users.map(u => ({
    ...u,
    disabled: Boolean(u.disabled),
    admin_shared_api_enabled: Boolean(u.admin_shared_api_enabled),
    last_login_at: u.last_login_at || null
  }));
}

export function getUsersPaginated(page: number, pageSize: number, search: string): {
  users: PublicDbUser[];
  total: number;
  page: number;
  pageSize: number;
} {
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  let params: any[] = [];

  if (search) {
    whereClause = 'WHERE email LIKE ?';
    params.push(`%${search}%`);
  }

  const countResult = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM users ${whereClause}`, params);
  const total = countResult?.count || 0;

  const users = queryAll<any>(
    `SELECT id, email, role, disabled, admin_shared_api_enabled, created_at, updated_at, last_login_at FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    users: users.map(u => ({
      ...u,
      disabled: Boolean(u.disabled),
      admin_shared_api_enabled: Boolean(u.admin_shared_api_enabled),
      last_login_at: u.last_login_at || null
    })),
    total,
    page,
    pageSize,
  };
}

export function getUserByEmail(email: string): DbUser | undefined {
  return queryOne<DbUser>('SELECT * FROM users WHERE email = ?', [email]);
}

export function getUserById(id: string): Omit<DbUser, 'password_hash'> | undefined {
  return queryOne<Omit<DbUser, 'password_hash'>>(
    'SELECT id, email, role, disabled, auth_version, preferred_model, admin_shared_api_enabled, created_at, updated_at, last_login_at FROM users WHERE id = ?',
    [id],
  );
}

export function createUser(user: DbUser): Omit<DbUser, 'password_hash'> {
  run(
    'INSERT INTO users (id, email, password_hash, role, disabled, auth_version, preferred_model, admin_shared_api_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [user.id, user.email, user.password_hash, user.role, user.disabled, user.auth_version ?? 0, user.preferred_model ?? null, user.admin_shared_api_enabled ?? 0, user.created_at, user.updated_at]
  );
  return {
    id: user.id,
    email: user.email,
    role: user.role,
      disabled: user.disabled,
      auth_version: user.auth_version ?? 0,
      preferred_model: user.preferred_model ?? null,
      admin_shared_api_enabled: user.admin_shared_api_enabled ?? 0,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

export function updateUserRole(id: string, role: 'admin' | 'user'): boolean {
  const result = run(
    'UPDATE users SET role = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?',
    [role, new Date().toISOString(), id],
  );
  return result.changes > 0;
}

export function updateUserDisabled(id: string, disabled: number): boolean {
  const result = run(
    'UPDATE users SET disabled = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?',
    [disabled, new Date().toISOString(), id],
  );
  return result.changes > 0;
}

export function updateUserAdminApiSharing(id: string, enabled: number): boolean {
  const result = run(
    'UPDATE users SET admin_shared_api_enabled = ?, updated_at = ? WHERE id = ? AND role IN (\'admin\', \'user\')',
    [enabled ? 1 : 0, new Date().toISOString(), id],
  );
  return result.changes > 0;
}

export function updateUserLastLogin(id: string): boolean {
  const result = run('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  return result.changes > 0;
}

export function getInviteCode(role: DbInviteCode['role']): DbInviteCode | undefined {
  return queryOne<DbInviteCode>('SELECT role, code_hash, created_at, rotated_at, version FROM invite_codes WHERE role = ?', [role]);
}

export function listInviteCodes(): DbInviteCode[] {
  return queryAll<DbInviteCode>(
    "SELECT role, code_hash, created_at, rotated_at, version FROM invite_codes ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END",
  );
}

export function upsertInviteCode(record: DbInviteCode): DbInviteCode {
  if (getInviteCode(record.role)) {
    run(
      'UPDATE invite_codes SET code_hash = ?, created_at = ?, rotated_at = ?, version = ? WHERE role = ?',
      [record.code_hash, record.created_at, record.rotated_at, record.version, record.role],
    );
  } else {
    run(
      'INSERT INTO invite_codes (role, code_hash, created_at, rotated_at, version) VALUES (?, ?, ?, ?, ?)',
      [record.role, record.code_hash, record.created_at, record.rotated_at, record.version],
    );
  }
  return getInviteCode(record.role) || record;
}

export function getUserPreferredModel(userId: string, fallback: string): string {
  const row = queryOne<{ preferred_model: string | null }>('SELECT preferred_model FROM users WHERE id = ?', [userId]);
  return row?.preferred_model?.trim() || fallback;
}

export function updateUserPreferredModel(userId: string, model: string): boolean {
  const result = run(
    'UPDATE users SET preferred_model = ?, updated_at = ? WHERE id = ?',
    [model, new Date().toISOString(), userId],
  );
  return result.changes > 0;
}

export function createEmailCode(code: DbEmailCode): void {
  run('DELETE FROM email_codes WHERE email = ? AND purpose = ?', [code.email, code.purpose]);
  run(
    'INSERT INTO email_codes (id, email, code, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [code.id, code.email, emailCodeDigest(code.email, code.purpose, code.code), code.purpose, code.expires_at, code.created_at]
  );
}

export function verifyEmailCode(email: string, code: string, purpose: string): DbEmailCode | undefined {
  const now = new Date().toISOString();
  const record = queryOne<DbEmailCode>(
    'SELECT * FROM email_codes WHERE email = ? AND purpose = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [email, purpose, now],
  );
  if (!record) return undefined;
  const expected = emailCodeDigest(email, purpose, code);
  const stored = String(record.code || '');
  const matches = stored.startsWith('hmac-sha256:')
    ? safeTextEqual(stored, expected)
    : safeTextEqual(stored, code); // 兼容迁移前尚未过期的验证码。
  return matches ? record : undefined;
}

export function emailCodeDigest(email: string, purpose: string, code: string): string {
  const pepper = process.env.EMAIL_CODE_PEPPER || process.env.JWT_SECRET || 'dev-only-email-code-pepper';
  return 'hmac-sha256:' + crypto.createHmac('sha256', pepper)
    .update(`${email.toLowerCase()}\n${purpose}\n${code}`, 'utf8')
    .digest('hex');
}

export function safeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function deleteEmailCode(email: string, purpose: string): void {
  run('DELETE FROM email_codes WHERE email = ? AND purpose = ?', [email, purpose]);
}
