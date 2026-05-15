-- Initial schema capture: documents the existing PriceDesk database structure
-- This migration is for reference only — these tables already exist in production

-- Core key-value config store
CREATE TABLE IF NOT EXISTS app_data (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON app_data FOR ALL USING (true) WITH CHECK (true);

-- Lightweight sync table for Realtime notifications
CREATE TABLE IF NOT EXISTS pd_sync (
  key         TEXT PRIMARY KEY,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pd_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_sync" ON pd_sync FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE pd_sync;

-- Daily automated backups (7-day rolling)
CREATE TABLE IF NOT EXISTS pd_backups (
  backup_date TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pd_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_backups" ON pd_backups FOR ALL USING (true) WITH CHECK (true);

-- Per-row SKU storage (atomic operations, replaces JSON blob)
CREATE TABLE IF NOT EXISTS pd_skus_v2 (
  id                TEXT PRIMARY KEY,
  sku               TEXT,
  style_id          TEXT,
  brand_id          TEXT,
  category          TEXT,
  level             TEXT DEFAULT 'Level 2',
  cost              NUMERIC DEFAULT 0,
  markup            NUMERIC DEFAULT 0,
  discount          NUMERIC DEFAULT 0,
  ignore_threshold  BOOLEAN DEFAULT false,
  archived          BOOLEAN DEFAULT false,
  tags              JSONB DEFAULT '[]'::jsonb,
  note              TEXT DEFAULT '',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pd_skus_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_skus" ON pd_skus_v2 FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE pd_skus_v2;
