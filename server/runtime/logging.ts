import type { LogCategory } from '../log-service.js';

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.stack || error.name;
  if (typeof error === 'string' && error) return error;
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {}
  return String(error || '未知错误');
}

export function describeErrorData(error: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return {
    ...extra,
    error: describeError(error),
    ...(code ? { errorCode: code } : {}),
  };
}

export function notificationLogCategory(data: Record<string, unknown> = {}): LogCategory {
  const event = typeof data.event === 'string' ? data.event : '';
  const channels = Array.isArray(data.channels) ? data.channels : [];
  if (
    data.channel === 'email'
    || event.startsWith('email_')
    || event.startsWith('mail_')
    || event === 'high_priority_email_enqueue'
    || (event === 'daily_digest_enqueue' && channels.includes('email'))
  ) return 'mail';
  return 'reminder';
}
