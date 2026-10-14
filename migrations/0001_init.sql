-- ShortLink initial schema
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',            -- 'admin' | 'user'
  perms TEXT NOT NULL DEFAULT '{}',             -- {create_links, view_logs, use_api}
  domain_ids TEXT NOT NULL DEFAULT '[]',        -- JSON array of domain ids (regular users)
  quota_max_links INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passkeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  credential_id TEXT NOT NULL UNIQUE,           -- base64url
  public_key BLOB NOT NULL,                     -- raw COSE key bytes
  alg INTEGER NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  backup_eligible INTEGER NOT NULL DEFAULT 0,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                          -- sha256(token)
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname TEXT NOT NULL UNIQUE,
  remark TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,          -- serves the management UI
  defaults TEXT NOT NULL DEFAULT '{}',          -- prefill for new links on this domain
  link_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  target TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'direct',          -- 'direct' | 'page' | 'confirm'
  style TEXT NOT NULL DEFAULT '{}',             -- animation / confirm page customization
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  created_by INTEGER,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(domain_id, code)
);
CREATE INDEX IF NOT EXISTS idx_links_domain ON links(domain_id);
CREATE INDEX IF NOT EXISTS idx_links_owner ON links(created_by);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,                -- sha256 hex
  scopes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  ip TEXT,
  country TEXT,
  city TEXT,
  ua TEXT,
  referer TEXT,
  status TEXT NOT NULL DEFAULT 'hit'            -- hit | expired | disabled | notfound
);
CREATE INDEX IF NOT EXISTS idx_logs_link_ts ON logs(link_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('site_name', '"ShortLink"'),
  ('retention_days', '90'),
  ('session_days', '14'),
  ('auto_delete_expired_days', '30'),
  ('default_mode', '"direct"'),
  ('default_style', '{}');
