-- Notation des personal shoppers par leurs clients (après avoir travaillé ensemble)
CREATE TABLE IF NOT EXISTS shopper_ratings (
  id BIGSERIAL PRIMARY KEY,
  shopper_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (shopper_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_shopper ON shopper_ratings(shopper_id);
