import { migrateAiHistory, migrateUsers, migrateSessions, migratePreferences, migrateNotes, migrateLibraryEntries, migrateLibraryVersions, type SchemaQueries } from './migrations.js';
import type { Database } from 'sql.js';

// Existing creation, column migrations, data backfills and indexes stay in their original order.
export function applyChatSchema(db: Database, { queryAll, queryOne }: SchemaQueries): void {
  // sql.js 以内存数据库运行并整体导出文件，不能消费原生 SQLite WAL。
  db.run('PRAGMA journal_mode = DELETE');

  db.run(`CREATE TABLE IF NOT EXISTS operation_results (
    user_id TEXT NOT NULL, scope TEXT NOT NULL, operation_id TEXT NOT NULL,
    result TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, scope, operation_id)
  )`);

  // 初始化表
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      sdk_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL,
      tool_calls TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_schedule_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      intent TEXT,
      schedule_items TEXT,
      plan TEXT,
      knowledge_sources TEXT,
      created_at TEXT NOT NULL
    )
  `);

  migrateAiHistory(db, { queryAll, queryOne });

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      auth_version INTEGER NOT NULL DEFAULT 0,
      preferred_model TEXT,
      admin_shared_api_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )
  `);

  migrateUsers(db, { queryAll, queryOne });

  db.run(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      role TEXT PRIMARY KEY CHECK (role IN ('admin', 'user')),
      code_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      rotated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )
  `);

  migrateSessions(db, { queryAll, queryOne });

  db.run(`
    CREATE TABLE IF NOT EXISTS email_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset_password')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      hour INTEGER NOT NULL DEFAULT 8,
      minute INTEGER NOT NULL DEFAULT 0,
      reminder_email TEXT,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      report_email_enabled INTEGER NOT NULL DEFAULT 0,
      daily_report_delivery_sources TEXT NOT NULL DEFAULT '["local"]',
      in_app_enabled INTEGER NOT NULL DEFAULT 1,
      browser_enabled INTEGER NOT NULL DEFAULT 1,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_start TEXT NOT NULL DEFAULT '22:00',
      quiet_end TEXT NOT NULL DEFAULT '08:00',
      home_location_name TEXT,
      home_location_admin1 TEXT,
      home_location_country TEXT,
      home_latitude REAL,
      home_longitude REAL,
      home_timezone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  migratePreferences(db, { queryAll, queryOne });

  db.run(`
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      api_key TEXT NOT NULL,
      base_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ChatGPT Work Cloud 的日报连接使用独立 OAuth 记录；只保存哈希和最小授权元数据。
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_contexts (
      user_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_cloud_activity (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      title TEXT NOT NULL,
      evidence TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      redirect_uris_json TEXT NOT NULL,
      grant_types_json TEXT NOT NULL,
      response_types_json TEXT NOT NULL,
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      state TEXT,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      resource TEXT NOT NULL,
      csrf_hash TEXT NOT NULL,
      user_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      rotated_at TEXT,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_mail_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'qq' CHECK (provider = 'qq'),
      username TEXT NOT NULL,
      encrypted_auth_code TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS note_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_optimized INTEGER NOT NULL DEFAULT 0,
      optimization_count INTEGER NOT NULL DEFAULT 0,
      optimization_previous_content TEXT,
      content_revision INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      color TEXT NOT NULL DEFAULT 'neutral' CHECK (color IN ('neutral', 'purple', 'blue', 'green', 'amber', 'rose')),
      linked_schedule_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  migrateNotes(db, { queryAll, queryOne });

  db.run(`
    CREATE TABLE IF NOT EXISTS library_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('fragment', 'article')),
      type TEXT NOT NULL CHECK (type IN ('knowledge', 'insight', 'framework', 'experience', 'tutorial', 'reference')),
      source_id TEXT,
      slug TEXT,
      title TEXT,
      content TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_ref TEXT,
      source_url TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      relations_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      archived_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  migrateLibraryEntries(db, { queryAll, queryOne });

  db.run(`
    CREATE TABLE IF NOT EXISTS library_preferences (
      user_id TEXT PRIMARY KEY,
      sort TEXT NOT NULL CHECK (sort IN ('title_asc', 'title_desc', 'updated_asc', 'updated_desc', 'created_asc', 'created_desc')),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Cloud 日报媒体准备批次；媒体正文仍保存在 daily-report-media 文件目录，数据库只保存归属和校验元数据。
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_media_batches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('PREPARING', 'READY', 'COMMITTED', 'FAILED', 'PENDING_RETRY', 'EXPIRED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      committed_at TEXT,
      failure_reason TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_report_media_assets (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('HOSTED', 'FAILED')),
      selected_candidate INTEGER,
      original_url TEXT,
      source_url TEXT,
      source_domain TEXT,
      hosted_url TEXT,
      filename TEXT,
      sha256 TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      attempts_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (batch_id, asset_key),
      FOREIGN KEY (batch_id) REFERENCES daily_report_media_batches(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS library_entry_versions (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      title TEXT,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      relations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  migrateLibraryVersions(db, { queryAll, queryOne });

  db.run(`
    CREATE TABLE IF NOT EXISTS library_comments (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS library_publish_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 创建索引
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ai_schedule_messages_user_created ON ai_schedule_messages(user_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_token_hash ON daily_report_tokens(token_hash)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_cloud_activity_user_date ON daily_report_cloud_activity(user_id, activity_date DESC, updated_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_media_batches_user_date ON daily_report_media_batches(user_id, report_date DESC, updated_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_media_batches_expiry ON daily_report_media_batches(status, expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_report_media_assets_batch ON daily_report_media_assets(batch_id, updated_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_expires ON oauth_authorization_requests(expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expires ON oauth_authorization_codes(expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_user ON oauth_access_tokens(user_id, revoked_at, expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family ON oauth_refresh_tokens(family_id, revoked_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_note_items_user_updated ON note_items(user_id, updated_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_entries_user_updated ON library_entries(user_id, updated_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_entries_user_kind ON library_entries(user_id, kind, status)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_library_entries_user_source ON library_entries(user_id, source_id) WHERE source_id IS NOT NULL');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_versions_entry_created ON library_entry_versions(entry_id, created_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_library_comments_entry_created ON library_comments(entry_id, created_at ASC)');
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_library_publish_token_hash ON library_publish_tokens(token_hash)');

}
