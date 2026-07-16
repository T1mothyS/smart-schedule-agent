export interface CodeBuddyCredential {
  api_key: string;
  base_url?: string | null;
}

export function buildCodeBuddyEnv(credential: CodeBuddyCredential): Record<string, string> {
  const env: Record<string, string> = {
    CODEBUDDY_API_KEY: credential.api_key,
    CODEBUDDY_INTERNET_ENVIRONMENT: 'internal',
  };
  if (credential.base_url) env.CODEBUDDY_BASE_URL = credential.base_url;
  return env;
}
