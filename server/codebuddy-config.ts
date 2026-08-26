export function assertNoLegacyCodeBuddyConfig(env: NodeJS.ProcessEnv): void {
  if (env.CODEBUDDY_API_KEY?.trim() || env.CODEBUDDY_BASE_URL?.trim()) {
    throw new Error('[Config] 已废止服务器级 CODEBUDDY_API_KEY/CODEBUDDY_BASE_URL，请先在账号设置中保存个人 API Key');
  }
}
