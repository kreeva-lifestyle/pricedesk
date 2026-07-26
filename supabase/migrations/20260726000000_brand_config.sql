-- Per-brand pricing settings.
--
-- Commission, shipping (forward + return), collection fee and fixed fees can
-- be overridden per brand. Overrides are stored sparsely: only the sections a
-- brand actually customises are present, and an absent section means "inherit
-- the global settings". Existing brands get NULL, so their prices are
-- unchanged.
--
-- Shape:
--   {
--     "comm": { "COMM_MODE": "...", "COMM_SLABS": [...], "COMM_MYNTRA": {...}, ... },
--     "fwd":  { "GT_SLABS": [...], "GT_DATA": {...}, "myn_fwd_mode": "...", ... },
--     "ret":  { "REV_SLABS": [...], "REVERSE_FEES": {...}, ... },
--     "coll": { "COLL_SLABS": [...], "COLL_CAT_SLABS": {...}, "COLL_FEE_DATA": {...} },
--     "fees": { "myn_pg_fee": 50.22, "ajio_fwd": 70, ... }
--   }
--
-- Sections are closed under indexing: a slab-bounds array and every rate array
-- indexed by it live in the SAME section, so a brand can never override the
-- bounds while inheriting the rates.
--
-- This lives on pd_brands rather than in a child table so that the existing
-- realtime channel, calc-cache invalidation, backup (select=*) and
-- export/import paths all carry it with no further changes, and so deleting a
-- brand drops its settings automatically.

ALTER TABLE pd_brands ADD COLUMN IF NOT EXISTS config JSONB;


-- ── Referential integrity for pd_skus_v2.brand_id ────────────────────────
--
-- Until now nothing in the database enforced that a SKU's brand_id points at
-- a real brand — integrity was maintained only by JavaScript in the browser.
-- That is a bad place to enforce it: a stale tab, a concurrent delete on
-- another device or a direct API write can all strand a SKU with a dangling
-- brand_id, and calcSKU then prices it as Myntra-with-no-override. It shows a
-- WRONG PROFIT rather than an error, which is the worst failure mode for a
-- pricing tool.
--
-- ON DELETE RESTRICT rather than CASCADE: deleting a brand must never delete
-- the products. The app offers to reassign them instead.

-- Empty strings would violate the foreign key; NULL is the correct "unassigned".
UPDATE pd_skus_v2 SET brand_id = NULL WHERE brand_id = '';

DO $$
DECLARE orphans INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pd_skus_v2_brand_id_fkey') THEN
    RAISE NOTICE 'pd_skus_v2_brand_id_fkey already exists — nothing to do';
    RETURN;
  END IF;

  SELECT count(*) INTO orphans
  FROM pd_skus_v2 s
  WHERE s.brand_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pd_brands b WHERE b.id = s.brand_id);

  IF orphans > 0 THEN
    -- Don't fail the whole migration; the app can repair these, and adding the
    -- constraint later is a one-liner.
    RAISE NOTICE 'Skipping brand_id foreign key: % SKU row(s) reference a brand that no longer exists. Repair them in PriceDesk (Settings → Data health), then re-run this migration.', orphans;
    RETURN;
  END IF;

  ALTER TABLE pd_skus_v2
    ADD CONSTRAINT pd_skus_v2_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES pd_brands(id) ON DELETE RESTRICT;
  RAISE NOTICE 'Added pd_skus_v2_brand_id_fkey (ON DELETE RESTRICT)';
END $$;
