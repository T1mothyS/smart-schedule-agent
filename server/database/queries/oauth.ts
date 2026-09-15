import { queryOne, run } from '../connection.js';
import type { DbOAuthClient, DbOAuthAuthorizationRequest, DbOAuthAuthorizationCode, DbOAuthAccessToken, DbOAuthRefreshToken } from '../types.js';

export function createOAuthClient(client: DbOAuthClient): DbOAuthClient {
  run(
    `INSERT INTO oauth_clients
     (client_id, client_name, redirect_uris_json, grant_types_json, response_types_json,
      token_endpoint_auth_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.client_id,
      client.client_name,
      client.redirect_uris_json,
      client.grant_types_json,
      client.response_types_json,
      client.token_endpoint_auth_method,
      client.created_at,
      client.updated_at,
    ],
  );
  return client;
}

export function getOAuthClient(clientId: string): DbOAuthClient | undefined {
  return queryOne<DbOAuthClient>('SELECT * FROM oauth_clients WHERE client_id = ?', [clientId]);
}

export function createOAuthAuthorizationRequest(request: DbOAuthAuthorizationRequest): DbOAuthAuthorizationRequest {
  run(
    `INSERT INTO oauth_authorization_requests
     (id, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method,
      resource, csrf_hash, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      request.id,
      request.client_id,
      request.redirect_uri,
      request.scope,
      request.state,
      request.code_challenge,
      request.code_challenge_method,
      request.resource,
      request.csrf_hash,
      request.user_id,
      request.expires_at,
      request.created_at,
    ],
  );
  return request;
}

export function getOAuthAuthorizationRequest(id: string): DbOAuthAuthorizationRequest | undefined {
  return queryOne<DbOAuthAuthorizationRequest>('SELECT * FROM oauth_authorization_requests WHERE id = ?', [id]);
}

export function setOAuthAuthorizationRequestUser(id: string, userId: string): boolean {
  return run('UPDATE oauth_authorization_requests SET user_id = ? WHERE id = ?', [userId, id]).changes > 0;
}

export function setOAuthAuthorizationRequestScope(id: string, scope: string): boolean {
  return run('UPDATE oauth_authorization_requests SET scope = ? WHERE id = ?', [scope, id]).changes > 0;
}

export function deleteOAuthAuthorizationRequest(id: string): boolean {
  return run('DELETE FROM oauth_authorization_requests WHERE id = ?', [id]).changes > 0;
}

export function createOAuthAuthorizationCode(code: DbOAuthAuthorizationCode): DbOAuthAuthorizationCode {
  run(
    `INSERT INTO oauth_authorization_codes
     (code_hash, client_id, user_id, redirect_uri, scope, code_challenge,
      code_challenge_method, resource, expires_at, created_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code.code_hash,
      code.client_id,
      code.user_id,
      code.redirect_uri,
      code.scope,
      code.code_challenge,
      code.code_challenge_method,
      code.resource,
      code.expires_at,
      code.created_at,
      code.used_at,
    ],
  );
  return code;
}

export function getOAuthAuthorizationCode(codeHash: string): DbOAuthAuthorizationCode | undefined {
  return queryOne<DbOAuthAuthorizationCode>('SELECT * FROM oauth_authorization_codes WHERE code_hash = ?', [codeHash]);
}

export function markOAuthAuthorizationCodeUsed(codeHash: string, usedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_authorization_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL',
    [usedAt, codeHash],
  ).changes > 0;
}

export function createOAuthAccessToken(token: DbOAuthAccessToken): DbOAuthAccessToken {
  run(
    `INSERT INTO oauth_access_tokens
     (token_hash, client_id, user_id, scope, resource, expires_at, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [token.token_hash, token.client_id, token.user_id, token.scope, token.resource, token.expires_at, token.created_at, token.last_used_at, token.revoked_at],
  );
  return token;
}

export function getActiveOAuthAccessToken(tokenHash: string): DbOAuthAccessToken | undefined {
  return queryOne<DbOAuthAccessToken>(
    `SELECT t.* FROM oauth_access_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
    [tokenHash],
  );
}

export function markOAuthAccessTokenUsed(tokenHash: string, usedAt = new Date().toISOString()): void {
  run(
    'UPDATE oauth_access_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [usedAt, tokenHash],
  );
}

export function revokeOAuthAccessToken(tokenHash: string, revokedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_access_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [revokedAt, tokenHash],
  ).changes > 0;
}

export function createOAuthRefreshToken(token: DbOAuthRefreshToken): DbOAuthRefreshToken {
  run(
    `INSERT INTO oauth_refresh_tokens
     (token_hash, family_id, client_id, user_id, scope, resource, expires_at, created_at,
      last_used_at, revoked_at, rotated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token.token_hash,
      token.family_id,
      token.client_id,
      token.user_id,
      token.scope,
      token.resource,
      token.expires_at,
      token.created_at,
      token.last_used_at,
      token.revoked_at,
      token.rotated_at,
    ],
  );
  return token;
}

export function getActiveOAuthRefreshToken(tokenHash: string): DbOAuthRefreshToken | undefined {
  return queryOne<DbOAuthRefreshToken>(
    `SELECT t.* FROM oauth_refresh_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled = 0`,
    [tokenHash],
  );
}

export function getActiveOAuthRefreshTokenForClientUser(clientId: string, userId: string): DbOAuthRefreshToken | undefined {
  return queryOne<DbOAuthRefreshToken>(
    `SELECT * FROM oauth_refresh_tokens
     WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
       AND (' ' || scope || ' ') LIKE '% offline_access %'
     ORDER BY created_at DESC
     LIMIT 1`,
    [clientId, userId, new Date().toISOString()],
  );
}

export function getOAuthRefreshToken(tokenHash: string): DbOAuthRefreshToken | undefined {
  return queryOne<DbOAuthRefreshToken>('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?', [tokenHash]);
}

export function markOAuthRefreshTokenUsed(tokenHash: string, usedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_refresh_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [usedAt, tokenHash],
  ).changes > 0;
}

export function revokeOAuthRefreshFamily(familyId: string, revokedAt = new Date().toISOString()): number {
  return run(
    'UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
    [revokedAt, familyId],
  ).changes;
}

export function revokeOAuthRefreshToken(tokenHash: string, revokedAt = new Date().toISOString()): boolean {
  return run(
    'UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    [revokedAt, tokenHash],
  ).changes > 0;
}

export function deleteOAuthUserData(userId: string): void {
  run('DELETE FROM oauth_authorization_requests WHERE user_id = ?', [userId]);
  run('DELETE FROM oauth_authorization_codes WHERE user_id = ?', [userId]);
  run('DELETE FROM oauth_access_tokens WHERE user_id = ?', [userId]);
  run('DELETE FROM oauth_refresh_tokens WHERE user_id = ?', [userId]);
}
