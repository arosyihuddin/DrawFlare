CREATE TABLE IF NOT EXISTS whiteboards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled whiteboard',
  scene_json TEXT NOT NULL DEFAULT '{}',
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  whiteboard_id TEXT NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whiteboards_updated_at ON whiteboards(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_links_whiteboard_id ON share_links(whiteboard_id);