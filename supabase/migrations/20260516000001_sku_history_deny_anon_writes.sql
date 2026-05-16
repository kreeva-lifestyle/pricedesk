-- Lock down direct anon writes to pd_sku_history.
-- All writes now go through the sku-history-write Edge Function
-- (service-role). Validation is server-side; ts is DB-authoritative.

DROP POLICY IF EXISTS "allow_all_sku_history" ON pd_sku_history;

-- Keep SELECT open for the per-SKU history view (client renders these).
CREATE POLICY "sku_history_select_only" ON pd_sku_history
  FOR SELECT USING (true);
