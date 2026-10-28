-- Optional open-notification webhook per note. When set, the server POSTs a
-- small JSON event to this https URL after each successful open. Gated by the
-- notes.webhook capability so untrusted accounts cannot set one (SSRF surface).
ALTER TABLE notes ADD COLUMN webhook TEXT;
