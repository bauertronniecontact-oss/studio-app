-- Journal d'audit des actions admin
CREATE TABLE IF NOT EXISTS admin_log (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  admin_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id BIGINT,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log(created_at DESC);

-- Paramètres plateforme (clé/valeur)
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
