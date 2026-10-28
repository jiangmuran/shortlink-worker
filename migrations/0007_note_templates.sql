-- Reusable note-composer presets, per user. `config` is a small JSON blob of
-- composer field values (display / theme / limits); it is only ever read back
-- by its owner and applied client-side as input values, never as markup.
CREATE TABLE note_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_note_templates_user ON note_templates(user_id, id);
