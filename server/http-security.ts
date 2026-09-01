import type { NextFunction, Request, RequestHandler, Response } from 'express';

interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
  matches: (request: Request) => boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const rules: RateRule[] = [
  { name: 'verification-email', limit: 5, windowMs: 15 * 60_000, matches: req => req.method === 'POST' && req.path === '/api/auth/send-register-code' },
  { name: 'authentication', limit: 20, windowMs: 15 * 60_000, matches: req => req.method === 'POST' && ['/api/auth/login', '/api/auth/register'].includes(req.path) },
  { name: 'outbound-email', limit: 5, windowMs: 60 * 60_000, matches: req => req.method === 'POST' && ['/api/action-center/send-email', '/api/cycle-reminders/test-email'].includes(req.path) },
  { name: 'ai', limit: 30, windowMs: 60_000, matches: req => req.method === 'POST' && (req.path === '/api/ai-chat' || req.path === '/api/ai/imports/parse') },
  { name: 'backup', limit: 20, windowMs: 60 * 60_000, matches: req => req.path.startsWith('/api/backups/') || req.path === '/api/backups/export' },
  { name: 'export', limit: 30, windowMs: 60 * 60_000, matches: req => req.method === 'GET' && req.path.startsWith('/api/exports/') },
  { name: 'weather', limit: 60, windowMs: 60_000, matches: req => req.method === 'GET' && req.path.startsWith('/api/weather/') },
  { name: 'daily-report-token', limit: 20, windowMs: 60 * 60_000, matches: req => ['POST', 'DELETE'].includes(req.method) && req.path === '/api/integrations/daily-report-token' },
  { name: 'daily-report', limit: 120, windowMs: 60_000, matches: req => ['/api/integrations/daily-report/agenda', '/api/integrations/daily-report/mail', '/api/integrations/daily-report/reports'].includes(req.path) || req.path.startsWith('/api/integrations/daily-report/reports/') },
  { name: 'daily-report-manual-send', limit: 5, windowMs: 60 * 60_000, matches: req => req.method === 'POST' && /^\/api\/daily-reports\/\d{4}-\d{2}-\d{2}\/send$/.test(req.path) },
  { name: 'user-mail-account', limit: 20, windowMs: 60 * 60_000, matches: req => req.path.startsWith('/api/user-mail-account') },
];

export class InMemoryRateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (this.buckets.size > 10_000) {
      for (const [candidate, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(candidate);
      }
      for (const candidate of this.buckets.keys()) {
        if (this.buckets.size <= 8_000) break;
        this.buckets.delete(candidate);
      }
    }
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }
}

export function createApiRateLimiter(store = new InMemoryRateLimitStore()): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const rule = rules.find(candidate => candidate.matches(req));
    if (!rule) return next();
    const result = store.consume(`${rule.name}:${req.ip}`, rule.limit, rule.windowMs);
    res.setHeader('X-RateLimit-Limit', String(rule.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

export function securityHeaders(isProduction: boolean): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (isProduction) {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
      ].join('; '));
    }
    next();
  };
}
