import type express from 'express';
import jwt from 'jsonwebtoken';
import type { DbUser } from './db.js';
// JWT payload 类型
export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  authVersion: number;
}


export function createAuth({ secret: JWT_SECRET, getUserById }: { secret: string; getUserById: (id: string) => Omit<DbUser, 'password_hash'> | undefined }) {
  const JWT_EXPIRES_IN = '7d';
  function signUserToken(user: Pick<DbUser, 'id' | 'email' | 'role' | 'auth_version'>): string {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role, authVersion: user.auth_version ?? 0 },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );
  }

  // 认证中间件
  function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: '未登录，请先登录' });
    }
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      const current = getUserById(payload.userId);
      if (!current || current.disabled) {
        return res.status(401).json({ error: '账号不存在或已被禁用，请重新登录' });
      }
      if ((payload.authVersion ?? -1) !== (current.auth_version ?? 0)) {
        return res.status(401).json({ error: '登录状态已失效，请重新登录' });
      }
      (req as any).user = {
        userId: current.id,
        email: current.email,
        role: current.role,
        authVersion: current.auth_version ?? 0,
      } satisfies JwtPayload;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Token 无效或已过期，请重新登录' });
    }
  }

  // 管理员中间件
  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if ((req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  }


  return { signUserToken, authenticate, requireAdmin };
}
