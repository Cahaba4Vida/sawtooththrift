-- Sawtooth Thrift commerce schema (DB-first)

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  inventory INT NOT NULL DEFAULT 1,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_notes TEXT NOT NULL DEFAULT '',
  buy_price_max_cents INT,
  search_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_status_chk CHECK (status IN ('draft','active','archived')),
  CONSTRAINT products_inventory_chk CHECK (inventory >= 0),
  CONSTRAINT products_price_chk CHECK (price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS products_status_idx ON products (status);
CREATE INDEX IF NOT EXISTS products_created_at_idx ON products (created_at DESC);

CREATE TABLE IF NOT EXISTS ai_opportunities (
  opp_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  max_buy_price_cents INT NOT NULL,
  suggested_price_cents INT NOT NULL,
  expected_margin_pct INT,
  search_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  condition_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_opportunities_category_chk CHECK (category IN ('clothes','shoes')),
  CONSTRAINT ai_opportunities_prices_chk CHECK (max_buy_price_cents >= 0 AND suggested_price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS ai_opportunities_category_idx ON ai_opportunities (category);
CREATE INDEX IF NOT EXISTS ai_opportunities_created_at_idx ON ai_opportunities (created_at DESC);

CREATE TABLE IF NOT EXISTS processed_stripe_sessions (
  session_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processed_stripe_sessions_processed_at_idx ON processed_stripe_sessions (processed_at DESC);
