-- v5: finer access control for notes — scheduled unlock, region, IP, device lock.
ALTER TABLE notes ADD COLUMN access TEXT NOT NULL DEFAULT '{}';   -- {geo_mode, geo_list, ip_list, lock_ip, lock_device}
ALTER TABLE notes ADD COLUMN unlock_at INTEGER;                   -- not openable before this time
ALTER TABLE notes ADD COLUMN bound TEXT NOT NULL DEFAULT '{}';    -- {ip, device} captured on first open
