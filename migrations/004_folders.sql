CREATE TABLE IF NOT EXISTS folders (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT,                 -- 'season' | 'event' | 'other'
  date_from DATE,
  date_to DATE,
  description TEXT,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_folders_client ON folders(client_id);

CREATE TABLE IF NOT EXISTS item_folders (
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  folder_id BIGINT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, folder_id)
);
CREATE INDEX IF NOT EXISTS idx_item_folders_folder ON item_folders(folder_id);
