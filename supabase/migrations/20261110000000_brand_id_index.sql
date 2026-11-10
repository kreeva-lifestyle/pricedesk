-- Covering index for the pd_skus_v2.brand_id foreign key.
--
-- 20260726000000_brand_config added the foreign key but no index behind it, so
-- Postgres had to scan the whole SKU table for:
--   * the ON DELETE RESTRICT check on every brand delete or brand_id change
--   * dbCountSKUsForBrand(), the database-verified delete guard in the app
--   * brand filtering and the per-brand chip counts on the SKU list
--
-- Harmless at ~2,000 rows, but the archive only grows and this sits on the
-- integrity path. An index cannot change query results, only how rows are
-- found, so this is reversible with a plain DROP INDEX.
--
-- Naming follows the existing convention: idx_audit_ts, idx_sku_history_sku.

CREATE INDEX IF NOT EXISTS idx_skus_brand_id ON pd_skus_v2 (brand_id);
