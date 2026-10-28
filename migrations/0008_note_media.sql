-- Image attachments for notes. Bytes live in R2 (binding MEDIA) under the key
-- note/{link_id}/{id}; they are stored exactly as the client uploaded them —
-- for e2e notes that is ciphertext the server cannot read. This table is the
-- metadata index so opens and cleanup can find a note's objects.
CREATE TABLE note_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_note_media_link ON note_media(link_id);
