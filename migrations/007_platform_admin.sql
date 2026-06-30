-- Super-admin plateforme (gère tous les comptes)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
UPDATE users SET is_admin = TRUE WHERE email = 'admin@studio.local';
