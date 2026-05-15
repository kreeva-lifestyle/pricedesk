-- Normalized tables: move high-value data out of app_data JSONB blobs
-- Each table mirrors the pd_skus_v2 pattern: per-row atomic operations

-- Brands
CREATE TABLE IF NOT EXISTS pd_brands (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  marketplace     TEXT,
  model           TEXT NOT NULL DEFAULT 'myntra',
  comm_override   NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pd_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_brands" ON pd_brands FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE pd_brands;

-- Categories (replaces pd_categories + pd_cat_levels blobs)
CREATE TABLE IF NOT EXISTS pd_categories (
  name        TEXT PRIMARY KEY,
  level       TEXT NOT NULL DEFAULT 'Level 2',
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pd_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_categories" ON pd_categories FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE pd_categories;

-- Commissions (unified: Myntra, Ajio PPMP, Ajio CC, Amazon)
CREATE TABLE IF NOT EXISTS pd_commissions (
  marketplace TEXT NOT NULL,
  category    TEXT NOT NULL,
  slab_index  INTEGER DEFAULT 0,
  rate        NUMERIC NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (marketplace, category, slab_index)
);
ALTER TABLE pd_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_commissions" ON pd_commissions FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE pd_commissions;

-- Thresholds
CREATE TABLE IF NOT EXISTS pd_thresholds (
  category    TEXT PRIMARY KEY,
  min_profit  NUMERIC NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pd_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_thresholds" ON pd_thresholds FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE pd_thresholds;

-- Audit log (append-only, replaces capped JSONB array)
CREATE TABLE IF NOT EXISTS pd_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ DEFAULT NOW(),
  user_name   TEXT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  details     TEXT,
  extra       JSONB
);
ALTER TABLE pd_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_audit" ON pd_audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON pd_audit_log (ts DESC);

-- SKU history (per-change tracking, replaces JSONB blob)
CREATE TABLE IF NOT EXISTS pd_sku_history (
  id          BIGSERIAL PRIMARY KEY,
  sku_id      TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_val     TEXT,
  new_val     TEXT,
  user_name   TEXT,
  ts          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pd_sku_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_sku_history" ON pd_sku_history FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_sku_history_sku ON pd_sku_history (sku_id, ts DESC);
