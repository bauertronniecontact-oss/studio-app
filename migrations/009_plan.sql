-- Plan d'abonnement du styliste (free | pro)
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
