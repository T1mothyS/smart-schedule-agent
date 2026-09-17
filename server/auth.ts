import type express from 'express';
import jwt from 'jsonwebtoken';
import type { DbUser } from './db.js';

export const PAGE_SESSION_COOKIE = 'aicalendar_page_session';
const JWT_EXPIRES_IN = '7d';
const PAGE_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// JWT payload 类型
export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  authVersion: number;
}

function readCookie(request: express.Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try { return decodeURIComponent(value); }
    catch { return undefined; }
  }
  return undefined;
}

function serializePageSessionCookie(token: string, secure: boolean): string {
  return [
    `${PAGE_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${PAGE_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function serializeClearedPageSessionCookie(secure: boolean): string {
  return [
    `${PAGE_SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function bearerToken(request: express.Request): string | undefined {
  const authHeader = request.headers.authorization;
  return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
}


export function createAuth({ secret: JWT_SECRET, getUserById, isProduction = false }: {
  secret: string;
  getUserById: (id: string) => Omit<DbUser, 'password_hash'> | undefined;
  isProduction?: boolean;
}) {
  function signUserToken(user: Pick<DbUser, 'id' | 'email' | 'role' | 'auth_version'>): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role, authVersion: user.auth_version ?? 0 },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
  }

  function verifyUserToken(token: string): { payload?: JwtPayload; error?: string } {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as Partial<JwtPayload>;
      if (typeof decoded.userId !== 'string' || typeof decoded.email !== 'string'
        || (decoded.role !== 'admin' && decoded.role !== 'user')) {
        return { error: 'Token 无效或已过期，请重新登录' };
      }
      const payload: JwtPayload = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        authVersion: typeof decoded.authVersion === 'number' ? decoded.authVersion : -1,
      };
      const current = getUserById(payload.userId);
      if (!current || current.disabled) {
        return { error: '账号不存在或已被禁用，请重新登录' };
      }
      if ((payload.authVersion ?? -1) !== (current.auth_version ?? 0)) {
        return { error: '登录状态已失效，请重新登录' };
      }
      return { payload: {
        userId: current.id,
        email: current.email,
        role: current.role,
        authVersion: current.auth_version ?? 0,
      } satisfies JwtPayload };
    } catch (err) {
      return { error: 'Token 无效或已过期，请重新登录' };
    }
  }

  // API 认证只接受 Bearer，不读取网页 Cookie。
  function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: '未登录，请先登录' });
    const result = verifyUserToken(token);
    if (!result.payload) return res.status(401).json({ error: result.error || 'Token 无效或已过期，请重新登录' });
    (req as any).user = result.payload;
    next();
  }

  function redirectToLogin(req: express.Request, res: express.Response): void {
    const requestedPath = req.originalUrl.startsWith('/') && !req.originalUrl.startsWith('//')
      ? req.originalUrl
      : '/tools';
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(302, `/login?next=${encodeURIComponent(requestedPath)}`);
  }

  // 原始挂载工具和其资源只接受专用网页 Cookie；Cookie 失效时回到登录页。
  function authenticatePage(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = readCookie(req, PAGE_SESSION_COOKIE);
    if (!token) return redirectToLogin(req, res);
    const result = verifyUserToken(token);
    if (!result.payload) return redirectToLogin(req, res);
    (req as any).user = result.payload;
    next();
  }

  function setPageSessionCookie(res: express.Response, token: string): void {
    res.append('Set-Cookie', serializePageSessionCookie(token, isProduction));
  }

  function setPageSessionFromBearer(req: express.Request, res: express.Response): void {
    const token = bearerToken(req);
    if (token) setPageSessionCookie(res, token);
  }

  function clearPageSessionCookie(res: express.Response): void {
    res.append('Set-Cookie', serializeClearedPageSessionCookie(isProduction));
  }

  // 管理员中间件
  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if ((req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  }


  return {
    signUserToken,
    authenticate,
    authenticatePage,
    requireAdmin,
    setPageSessionCookie,
    setPageSessionFromBearer,
    clearPageSessionCookie,
  };
}
