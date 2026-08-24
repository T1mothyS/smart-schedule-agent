import net from 'node:net';

export interface CodeBuddyCredential {
  api_key: string;
  base_url?: string | null;
}

export function normaliseCodeBuddyBaseUrl(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length > 2_048) throw new Error('CodeBuddy Base URL 过长');
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error('CodeBuddy Base URL 必须是完整 URL'); }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('CodeBuddy Base URL 必须是不含账号、查询参数和片段的 HTTPS URL');
  }
  if (
    net.isIP(hostname)
    || !hostname.includes('.')
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
  ) {
    throw new Error('CodeBuddy Base URL 必须使用公网域名，不能指向本机、IP 或内部域名');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function buildCodeBuddyEnv(credential: CodeBuddyCredential): Record<string, string> {
  const env: Record<string, string> = {
    CODEBUDDY_API_KEY: credential.api_key,
    CODEBUDDY_INTERNET_ENVIRONMENT: 'internal',
  };
  const baseUrl = normaliseCodeBuddyBaseUrl(credential.base_url);
  if (baseUrl) env.CODEBUDDY_BASE_URL = baseUrl;
  return env;
}
