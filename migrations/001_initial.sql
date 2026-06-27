-- Studio Personal Shopping — Schéma Postgres pour Supabase
-- À exécuter une fois dans Supabase SQL Editor

-- (optionnel) supprime la table de test
DROP TABLE IF EXISTS "STYLEHUB Project";

-- ─── USERS (personal shoppers) ───
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  studio_name TEXT,
  studio_logo TEXT,
  accent_color TEXT,
  photo_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CLIENTS ───
CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  position INTEGER DEFAULT 0,
  tags JSONB,
  -- profil + préférences
  profile_json JSONB,
  profile_filled_by TEXT, -- 'shopper' | 'client' | null
  welcome_message TEXT,
  photo_url TEXT,
  -- CRM
  status TEXT,
  birthday TEXT,
  last_contact_at TIMESTAMPTZ,
  next_action TEXT,
  next_action_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  -- Auth client
  email TEXT,
  password_hash TEXT,
  magic_token TEXT,
  magic_expires TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(slug);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_magic ON clients(magic_token);

-- ─── ITEMS (pièces de la sélection) ───
CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  cat TEXT,
  brand TEXT,
  name TEXT,
  price TEXT,
  amount NUMERIC,
  currency TEXT,
  link TEXT,
  image TEXT,
  description TEXT,
  position INTEGER DEFAULT 0,
  -- côté client
  liked BOOLEAN DEFAULT FALSE,
  comment TEXT,
  item_status TEXT, -- proposed | validated | bought | rejected
  -- soft delete
  deleted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_items_client ON items(client_id);
CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at);

-- ─── INSPIRATIONS ───
CREATE TABLE IF NOT EXISTS inspirations (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT,
  main_image TEXT,
  position INTEGER DEFAULT 0,
  is_template BOOLEAN DEFAULT FALSE,
  tags TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insp_client ON inspirations(client_id);
CREATE INDEX IF NOT EXISTS idx_insp_template ON inspirations(is_template);

-- ─── PIECES (zones d'ancrage sur l'image d'inspiration) ───
CREATE TABLE IF NOT EXISTS pieces (
  id BIGSERIAL PRIMARY KEY,
  inspiration_id BIGINT NOT NULL REFERENCES inspirations(id) ON DELETE CASCADE,
  label TEXT,
  anchor_x DOUBLE PRECISION DEFAULT 50,
  anchor_y DOUBLE PRECISION DEFAULT 50,
  position INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pieces_insp ON pieces(inspiration_id);

-- ─── REFS (références produit par pièce) ───
CREATE TABLE IF NOT EXISTS refs (
  id BIGSERIAL PRIMARY KEY,
  piece_id BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  brand TEXT,
  name TEXT,
  link TEXT,
  image TEXT,
  position INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_refs_piece ON refs(piece_id);

-- ─── EVENTS (analytics) ───
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target_id BIGINT,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  duration_ms INTEGER,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_client ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);

-- ─── NOTIFICATIONS ───
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id BIGINT,
  title TEXT,
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_client ON notifications(client_id);

-- ─── RLS (Row Level Security) ───
-- Pour l'instant on désactive — l'API côté serveur utilise la `secret key` qui contourne RLS.
-- À activer plus tard quand le frontend accédera directement à Supabase.
ALTER TABLE users         DISABLE ROW LEVEL SECURITY;
ALTER TABLE clients       DISABLE ROW LEVEL SECURITY;
ALTER TABLE items         DISABLE ROW LEVEL SECURITY;
ALTER TABLE inspirations  DISABLE ROW LEVEL SECURITY;
ALTER TABLE pieces        DISABLE ROW LEVEL SECURITY;
ALTER TABLE refs          DISABLE ROW LEVEL SECURITY;
ALTER TABLE events        DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
