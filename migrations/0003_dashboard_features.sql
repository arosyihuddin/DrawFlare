CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE whiteboards ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;
ALTER TABLE whiteboards ADD COLUMN deleted_at TEXT;
ALTER TABLE whiteboards ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_whiteboards_collection_id ON whiteboards(collection_id);
CREATE INDEX IF NOT EXISTS idx_whiteboards_deleted_at ON whiteboards(deleted_at);
CREATE INDEX IF NOT EXISTS idx_whiteboards_favorite ON whiteboards(is_favorite);

CREATE TABLE IF NOT EXISTS drawing_history (
  id TEXT PRIMARY KEY,
  whiteboard_id TEXT NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scene_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drawing_history_board_created ON drawing_history(whiteboard_id, created_at DESC);
