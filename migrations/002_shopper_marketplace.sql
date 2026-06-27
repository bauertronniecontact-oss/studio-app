-- Studio — Marketplace shoppers (B.1 + B.2 + B.3)

-- Profil public + portfolio
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio       JSONB;        -- array d'URLs d'images
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialties     TEXT;         -- "Smart casual, hiver, mariage..."
ALTER TABLE users ADD COLUMN IF NOT EXISTS years_experience INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_public       BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_slug     TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_tagline  TEXT;          -- petite phrase d'accroche
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_city     TEXT;          -- Genève, Lausanne...

-- Pour le flux "Demander un accès" : message libre du client
ALTER TABLE clients ADD COLUMN IF NOT EXISTS request_message TEXT;
