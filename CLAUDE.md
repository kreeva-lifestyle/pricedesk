# PriceDesk — Development Notes

## Architecture
- Single-file SPA: `index.html` (~7,900 lines)
- Backend: Supabase (PostgreSQL + Realtime + Edge Functions)
- SKU storage: `pd_skus_v2` table (per-row atomic operations)
- Config storage: `app_data` table (key-value JSONB)
- Realtime: `pd_skus_v2` (per-row) + `pd_sync` (config notifications)
- AI: Claude API via Supabase Edge Function (`claude-chat`)
- Deployment: GitHub Pages via GitHub Actions

## Key Conventions
- All monetary values in INR (₹), use `toLocaleString('en-IN')`
- GST: 5% if Customer Paid < ₹2,500, 18% if ≥ ₹2,500
- Collection fee lookup: by category × seller price band (not flat)
- "Seller Price" (not "Selling Price") — renamed throughout codebase
- "Customer Paid" = MRP - Discount (what buyer pays)
- Seller Price = Customer Paid - GT Charges
- Gross Settlement = Seller Price - Commission(AMT) - (Fix Fees × 1.18)
- Style ID is Myntra-only; "No Style ID" tag only shown for Myntra SKUs
- "STOCK OUT" tag auto-applied on archive, auto-removed on unarchive

## Database Tables
- `pd_skus_v2`: Individual SKU rows (primary source of truth)
- `app_data`: Key-value config (brands, thresholds, commissions, etc.)
- `pd_sync`: Realtime notifications for config changes
- `pd_backups`: 7-day rolling daily backups

## Critical Code Patterns
- `dbSaveSKU()`: Always tries table first, falls back to blob
- `dbDeleteSKU()`: Same table-first pattern
- `invalidateCalcCache()`: MUST be called before ANY render that uses calcSKU
- `save('skus')`: Debounced for edits, `save('skus',{immediate:true})` for critical ops
- All critical operations (delete, archive, add, tags) use immediate save
- Audit log saves immediately (not debounced)
- Session check before data load on init
- `_dataReady` must be true in ALL init paths (login, reset, valid session)

## Known Limitations
- SHA-256 password hashing without salt (browser limitation)
- Supabase anon key exposed in client (expected for SPA)
- Session cache is per-tab, not per-user (single-user app)
- localStorage still used for dashboard widget order (non-critical)
- No undo for permanent delete (only archive has undo via reinstate)

## Do NOT
- Remove `invalidateCalcCache()` calls before render functions
- Make saves fire-and-forget for critical operations (delete, archive, add)
- Set `_dataReady=true` before migrations complete
- Store images in the database (feature removed)
- Use `event: '*'` on Supabase Realtime for app_data (WAL bloat)
