-- v3: chat rooms. Add a `rooms` capability to the built-in groups (custom groups
-- inherit it via normalizeCaps defaults). The rooms table is created in 0004.

UPDATE groups SET caps = json_set(caps, '$.rooms', json('{"create":true,"max":20,"max_members":200}')), updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE builtin = 'trusted';
UPDATE groups SET caps = json_set(caps, '$.rooms', json('{"create":true,"max":5,"max_members":50}')),  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE builtin = 'member';
UPDATE groups SET caps = json_set(caps, '$.rooms', json('{"create":true,"max":1,"max_members":10}')),  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE builtin = 'restricted';
