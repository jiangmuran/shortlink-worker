-- v4: chat room settings, keyed to the short code (links row with kind='room').
CREATE TABLE IF NOT EXISTS rooms (
  link_id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'group',           -- 'dm' | 'group' | 'burn'
  max_members INTEGER NOT NULL DEFAULT 20,
  policy TEXT NOT NULL DEFAULT '{}',            -- retention, disappear, display, visible info
  access TEXT NOT NULL DEFAULT '{}',            -- password hash, login requirement
  destroyed_at INTEGER
);
