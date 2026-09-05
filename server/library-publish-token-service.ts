import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

const TOKEN_PREFIX = 'klp_';

export interface LibraryPublishTokenStatus {
  exists: boolean;
  active: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function hashLibraryPublishToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function getLibraryPublishTokenStatus(userId: string): LibraryPublishTokenStatus {
  const record = db.getLibraryPublishToken(userId);
  return record ? {
    exists: true,
    active: !record.revoked_at,
    prefix: record.token_prefix,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
    revokedAt: record.revoked_at,
  } : {
    exists: false,
    active: false,
    prefix: null,
    createdAt: null,
    lastUsedAt: null,
    revokedAt: null,
  };
}

export function generateLibraryPublishToken(userId: string): { token: string; status: LibraryPublishTokenStatus } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  db.replaceLibraryPublishToken({
    id: uuidv4(),
    user_id: userId,
    token_hash: hashLibraryPublishToken(token),
    token_prefix: token.slice(0, 12),
    created_at: now,
    last_used_at: null,
    revoked_at: null,
  });
  return { token, status: getLibraryPublishTokenStatus(userId) };
}

export function revokeLibraryPublishToken(userId: string): LibraryPublishTokenStatus {
  db.revokeLibraryPublishToken(userId);
  return getLibraryPublishTokenStatus(userId);
}

export function authenticateLibraryPublishToken(token: string, usedAt = new Date().toISOString()): { userId: string } | null {
  if (!/^klp_[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const record = db.findActiveLibraryPublishTokenByHash(hashLibraryPublishToken(token));
  if (!record) return null;
  db.markLibraryPublishTokenUsed(record.id, usedAt);
  return { userId: record.user_id };
}
