export interface DbSession {
  id: string;
  user_id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

export interface DbAiScheduleMessage {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  type: string;
  content: string;
  intent: string | null;
  schedule_items: string | null;
  plan: string | null;
  knowledge_sources?: string | null;
  created_at: string;
}

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  disabled: number;
  auth_version?: number;
  preferred_model?: string | null;
  admin_shared_api_enabled?: number;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface DbInviteCode {
  role: 'admin' | 'user';
  code_hash: string;
  created_at: string;
  rotated_at: string;
  version: number;
}

export interface DbEmailCode {
  id: string;
  email: string;
  code: string;
  purpose: 'register' | 'reset_password';
  expires_at: string;
  created_at: string;
}

export interface DbReminder {
  id: string;
  user_id: string;
  enabled: number;
  hour: number;
  minute: number;
  reminder_email?: string | null;
  email_enabled?: number;
  report_email_enabled?: number;
  daily_report_delivery_sources?: string | null;
  in_app_enabled?: number;
  browser_enabled?: number;
  timezone?: string;
  quiet_hours_enabled?: number;
  quiet_start?: string;
  quiet_end?: string;
  home_location_name?: string | null;
  home_location_admin1?: string | null;
  home_location_country?: string | null;
  home_latitude?: number | null;
  home_longitude?: number | null;
  home_timezone?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbUserApiKey {
  id: string;
  user_id: string;
  api_key: string;
  base_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbDailyReportToken {
  id: string;
  user_id: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DbDailyReportCloudContext {
  user_id: string;
  version: number;
  context_json: string;
  created_at: string;
  updated_at: string;
}

export interface DbDailyReportCloudActivity {
  id: string;
  user_id: string;
  activity_date: string;
  title: string;
  evidence: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export type DbDailyReportMediaBatchStatus = 'PREPARING' | 'READY' | 'COMMITTED' | 'FAILED' | 'PENDING_RETRY' | 'EXPIRED';

export interface DbDailyReportMediaBatch {
  id: string;
  user_id: string;
  report_date: string;
  run_id: string;
  status: DbDailyReportMediaBatchStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  committed_at: string | null;
  failure_reason: string | null;
}

export type DbDailyReportMediaAssetStatus = 'HOSTED' | 'FAILED';

export interface DbDailyReportMediaAsset {
  id: string;
  batch_id: string;
  asset_key: string;
  status: DbDailyReportMediaAssetStatus;
  selected_candidate: number | null;
  original_url: string | null;
  source_url: string | null;
  source_domain: string | null;
  hosted_url: string | null;
  filename: string | null;
  sha256: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  attempts_json: string;
  created_at: string;
  updated_at: string;
}

export interface DbOAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  grant_types_json: string;
  response_types_json: string;
  token_endpoint_auth_method: string;
  created_at: string;
  updated_at: string;
}

export interface DbOAuthAuthorizationRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  csrf_hash: string;
  user_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface DbOAuthAuthorizationCode {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  expires_at: string;
  created_at: string;
  used_at: string | null;
}

export interface DbOAuthAccessToken {
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DbOAuthRefreshToken {
  token_hash: string;
  family_id: string;
  client_id: string;
  user_id: string;
  scope: string;
  resource: string;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  rotated_at: string | null;
}

export interface DbUserMailAccount {
  id: string;
  user_id: string;
  provider: 'qq';
  username: string;
  encrypted_auth_code: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DbNoteItem {
  id: string;
  user_id: string;
  content: string;
  completed: number;
  completed_at: string | null;
  color: string;
  linked_schedule_ids: string;
  created_at: string;
  updated_at: string;
}

export interface DbLibraryEntry {
  id: string;
  user_id: string;
  kind: 'fragment' | 'article';
  type: 'knowledge' | 'insight' | 'framework' | 'experience' | 'tutorial' | 'reference';
  source_id: string | null;
  slug: string | null;
  title: string | null;
  content: string;
  summary: string;
  tags_json: string;
  status: 'draft' | 'active' | 'archived';
  source_type: string;
  source_ref: string | null;
  source_url: string | null;
  metadata_json: string;
  relations_json: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
}

export type DbLibrarySort = 'title_asc' | 'title_desc' | 'updated_asc' | 'updated_desc' | 'created_asc' | 'created_desc';

export interface DbLibraryPreference {
  user_id: string;
  sort: DbLibrarySort;
  updated_at: string;
}

export interface DbLibraryEntryVersion {
  id: string;
  entry_id: string;
  user_id: string;
  content_hash: string;
  title: string | null;
  summary: string;
  content: string;
  tags_json: string;
  relations_json: string;
  created_at: string;
}

export interface DbLibraryComment {
  id: string;
  entry_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface DbLibraryPublishToken {
  id: string;
  user_id: string;
  token_hash: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type PublicDbUser = Omit<DbUser, 'password_hash' | 'disabled' | 'last_login_at' | 'auth_version' | 'preferred_model' | 'admin_shared_api_enabled'> & {
  disabled: boolean;
  admin_shared_api_enabled: boolean;
  last_login_at: string | null;
};

export interface DbLibraryListFilters {
  q?: string;
  kind?: string;
  type?: string;
  status?: string;
  tag?: string;
  source_type?: string;
  limit?: number;
  offset?: number;
  sort?: DbLibrarySort;
  fetchAll?: boolean;
}

export type LibraryLifecycleAction = 'retire' | 'restore' | 'purge';

export interface LibraryLifecycleResult {
  action: LibraryLifecycleAction;
  items: Array<{
    sourceId: string;
    status: 'RETIRED' | 'RESTORED' | 'PURGED' | 'UNCHANGED' | 'NOT_FOUND';
    entryId?: string;
  }>;
  cleanedRelationCount: number;
  touchedEntryCount: number;
}
