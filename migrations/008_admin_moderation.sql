-- Modération plateforme : suspension de comptes + mise en avant des stylistes
ALTER TABLE users   ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE users   ADD COLUMN IF NOT EXISTS featured  BOOLEAN DEFAULT FALSE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT FALSE;
