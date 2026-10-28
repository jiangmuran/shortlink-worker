-- v2: user groups & capabilities, owner / scoped admins, invite & login links,
-- audit log, account freeze/expiry, burn-after-reading notes, daily click rollups.

-- ---------- user groups ----------
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  caps TEXT NOT NULL DEFAULT '{}',              -- capability JSON, see src/caps.js
  builtin TEXT,                                 -- preset key ('trusted' | 'member' | 'restricted') or NULL
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO groups(name, description, caps, builtin, created_at, updated_at) VALUES
('可信成员', '熟悉的人：额度宽松，可用全部功能',
 '{"links":{"create":true,"max":1000,"daily":0,"custom_code":true,"min_code_len":1,"modes":["direct","page","confirm"],"edit_target":true},"notes":{"create":true,"max_active":500,"daily":0,"e2e":true,"max_opens":0,"max_ttl_hours":0,"max_kb":64},"logs":{"view":true,"ip":"full","export":true},"api":{"use":true,"scopes":["links:read","links:write","logs:read","domains:read"]},"rate":{"per_minute":60}}',
 'trusted', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
('普通成员', '默认用户组：常规额度',
 '{"links":{"create":true,"max":100,"daily":0,"custom_code":true,"min_code_len":5,"modes":["direct","page","confirm"],"edit_target":true},"notes":{"create":true,"max_active":50,"daily":0,"e2e":true,"max_opens":0,"max_ttl_hours":0,"max_kb":64},"logs":{"view":true,"ip":"full","export":true},"api":{"use":true,"scopes":["links:read","links:write","domains:read"]},"rate":{"per_minute":30}}',
 'member', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
('受限成员', '给不熟悉的人：只能随机后缀、强制确认页、不能改目标、密信服务端加密、IP 打码',
 '{"links":{"create":true,"max":20,"daily":10,"custom_code":false,"min_code_len":7,"modes":["confirm"],"edit_target":false},"notes":{"create":true,"max_active":10,"daily":10,"e2e":false,"max_opens":5,"max_ttl_hours":168,"max_kb":16},"logs":{"view":true,"ip":"masked","export":false},"api":{"use":false,"scopes":[]},"rate":{"per_minute":5}}',
 'restricted', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- ---------- users ----------
ALTER TABLE users ADD COLUMN group_id INTEGER;
ALTER TABLE users ADD COLUMN caps_override TEXT NOT NULL DEFAULT '{}';   -- per-user tweaks on top of the group
ALTER TABLE users ADD COLUMN admin_perms TEXT NOT NULL DEFAULT '{}';     -- admins: {users, domains, settings, content}
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN expires_at INTEGER;                         -- temporary accounts
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN frozen_at INTEGER;
ALTER TABLE users ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN created_via TEXT NOT NULL DEFAULT '';

-- first admin becomes the owner; existing admins keep every admin permission
UPDATE users SET is_owner = 1 WHERE id = (SELECT MIN(id) FROM users WHERE role = 'admin');
UPDATE users SET admin_perms = '{"users":true,"domains":true,"settings":true,"content":true}' WHERE role = 'admin';

-- existing regular users: 普通成员 group, legacy perms/quota carried over as overrides
UPDATE users SET
  group_id = (SELECT id FROM groups WHERE builtin = 'member'),
  caps_override = json_object(
    'links', json_object(
      'create', json(CASE WHEN json_extract(perms, '$.create_links') THEN 'true' ELSE 'false' END),
      'max', quota_max_links,
      'min_code_len', 1),
    'logs', json_object('view', json(CASE WHEN json_extract(perms, '$.view_logs') THEN 'true' ELSE 'false' END)),
    'api', json_object('use', json(CASE WHEN json_extract(perms, '$.use_api') THEN 'true' ELSE 'false' END),
                       'scopes', json('["links:read","links:write","logs:read","domains:read"]'))
  )
WHERE role = 'user';

-- ---------- invite & login links ----------
CREATE TABLE IF NOT EXISTS access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                           -- 'invite' (sign up into a group) | 'login' (sign in as a user)
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  user_id INTEGER,                              -- login: account to sign into
  group_id INTEGER,                             -- invite: group for the new account
  domain_ids TEXT NOT NULL DEFAULT '[]',        -- invite: domains the new account may use
  account_days INTEGER,                         -- invite: new account expires after N days
  max_uses INTEGER NOT NULL DEFAULT 1,          -- 0 = unlimited
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user ON access_tokens(user_id);

-- ---------- audit log ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, ts DESC);

-- ---------- short codes now carry a kind ----------
ALTER TABLE links ADD COLUMN kind TEXT NOT NULL DEFAULT 'link';     -- 'link' | 'note' | 'room'
ALTER TABLE links ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0;     -- disabled by an account freeze
CREATE INDEX IF NOT EXISTS idx_links_kind_owner ON links(kind, created_by, created_at DESC);

-- ---------- burn-after-reading notes ----------
CREATE TABLE IF NOT EXISTS notes (
  link_id INTEGER PRIMARY KEY,
  cipher BLOB,                                  -- iv || AES-GCM ciphertext; NULL once burned
  enc TEXT NOT NULL DEFAULT 'e2e',              -- 'e2e' (key only in URL fragment) | 'server'
  kcv TEXT,                                     -- e2e: first bytes of SHA-256(key), checked before an open is consumed
  size INTEGER NOT NULL DEFAULT 0,
  max_opens INTEGER NOT NULL DEFAULT 1,         -- 0 = unlimited
  opens INTEGER NOT NULL DEFAULT 0,
  open_ttl INTEGER,                             -- seconds the note stays readable after the first open
  first_open_at INTEGER,
  pw_hash TEXT,
  pw_fail INTEGER NOT NULL DEFAULT 0,
  pw_max_fail INTEGER NOT NULL DEFAULT 5,       -- 0 = unlimited attempts
  display TEXT NOT NULL DEFAULT '{}',
  theme TEXT NOT NULL DEFAULT '{}',
  meta TEXT NOT NULL DEFAULT '{}',              -- public cover: title, from, hint
  burned_at INTEGER,
  burn_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_live ON notes(burned_at, first_open_at);

-- ---------- scale: daily click rollups & usage counters ----------
CREATE TABLE IF NOT EXISTS link_daily (
  link_id INTEGER NOT NULL,
  day INTEGER NOT NULL,                         -- days since epoch (UTC)
  clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
);
CREATE INDEX IF NOT EXISTS idx_link_daily_day ON link_daily(day);

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id INTEGER NOT NULL,
  bucket TEXT NOT NULL,                         -- 'd:<day>:<kind>' daily, 'm:<minute>' per-minute
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket)
);
