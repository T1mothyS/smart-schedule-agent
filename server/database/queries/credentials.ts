import { queryOne, run } from '../connection.js';
import type { DbUserApiKey, DbUserMailAccount } from '../types.js';

export function getUserApiKey(userId: string): DbUserApiKey | undefined {
  return queryOne<DbUserApiKey>('SELECT * FROM user_api_keys WHERE user_id = ?', [userId]);
}

export function getAdminSharedApiKey(): DbUserApiKey | undefined {
  return queryOne<DbUserApiKey>(
    `SELECT k.* FROM user_api_keys k
     JOIN users u ON u.id = k.user_id
     WHERE u.role = 'admin' AND u.disabled = 0
     ORDER BY u.created_at ASC
     LIMIT 1`,
  );
}

export function upsertUserApiKey(apiKey: DbUserApiKey): DbUserApiKey {
  const existing = getUserApiKey(apiKey.user_id);
  const now = new Date().toISOString();

  // 确保 base_url 不是 undefined（sql.js 不允许 undefined）
  const baseUrl = apiKey.base_url ?? null;

  if (existing) {
    run(
      'UPDATE user_api_keys SET api_key = ?, base_url = ?, updated_at = ? WHERE user_id = ?',
      [apiKey.api_key, baseUrl, now, apiKey.user_id]
    );
  } else {
    run(
      'INSERT INTO user_api_keys (id, user_id, api_key, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [apiKey.id, apiKey.user_id, apiKey.api_key, baseUrl, now, now]
    );
  }

  return { ...apiKey, base_url: baseUrl, updated_at: now };
}

export function deleteUserApiKey(userId: string): boolean {
  const result = run('DELETE FROM user_api_keys WHERE user_id = ?', [userId]);
  return result.changes > 0;
}

export function getUserMailAccount(userId: string): DbUserMailAccount | undefined {
  return queryOne<DbUserMailAccount>('SELECT * FROM user_mail_accounts WHERE user_id = ?', [userId]);
}

export function upsertUserMailAccount(account: DbUserMailAccount): DbUserMailAccount {
  const existing = getUserMailAccount(account.user_id);
  const now = account.updated_at || new Date().toISOString();
  if (existing) {
    run(
      `UPDATE user_mail_accounts SET provider = ?, username = ?, encrypted_auth_code = ?, enabled = ?, updated_at = ?
       WHERE user_id = ?`,
      [account.provider, account.username, account.encrypted_auth_code, account.enabled, now, account.user_id],
    );
  } else {
    run(
      `INSERT INTO user_mail_accounts
       (id, user_id, provider, username, encrypted_auth_code, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [account.id, account.user_id, account.provider, account.username, account.encrypted_auth_code, account.enabled, account.created_at, now],
    );
  }
  return { ...account, updated_at: now };
}

export function deleteUserMailAccount(userId: string): boolean {
  return run('DELETE FROM user_mail_accounts WHERE user_id = ?', [userId]).changes > 0;
}
