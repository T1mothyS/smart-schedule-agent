export type SettingsAuthHeaders = () => Record<string, string>;

export interface SettingsUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

export interface HomeLocation {
  name: string;
  admin1: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface DailyReportTokenStatus {
  exists: boolean;
  active: boolean;
  prefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface UserMailAccountStatus {
  configured: boolean;
  enabled: boolean;
  provider: 'qq';
  username: string | null;
  updatedAt: string | null;
  encryptionConfigured: boolean;
}
