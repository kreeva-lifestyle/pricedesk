# PriceDesk — Development Notes

## Architecture
- Single-file SPA: `index.html` (~7,900 lines)
- Build: Vite (`npm run build` → `dist/`) — GitHub Pages serves `dist/`
- Tests: Vitest (`npm test`) — 222+ unit tests in `tests/`
- CI: `.github/workflows/ci.yml` runs tests + build on every PR; deploy on merge to `main`
- Backend: Supabase (PostgreSQL + Realtime + Edge Functions)
- SKU storage: `pd_skus_v2` (per-row)
- Normalized config: `pd_brands`, `pd_categories`, `pd_commissions`, `pd_thresholds` (per-row, in Realtime)
- Append-only: `pd_audit_log` (INSERT+SELECT only via RLS), `pd_sku_history`
- Legacy key-value: `app_data` (logistics, wireframe, users, sessions, etc.)
- Realtime: per-row events on `pd_skus_v2`, `pd_brands`, `pd_categories`, `pd_commissions`, `pd_thresholds`; `pd_sync` carries notifications for the remaining `app_data` keys
- Backups: `pd_backups` (7-day rolling, GitHub Actions cron at midnight IST)
- Server-side auth: `login`, `reset-password` Edge Functions (service-role)
- AI: `claude-chat` Edge Function
- Bulk imports: `batch-import` Edge Function (atomic transactional upsert)
- Deployment: GitHub Pages via GitHub Actions; `dist/index.html` is the built artifact

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
- `pd_brands`, `pd_categories`, `pd_commissions`, `pd_thresholds`: normalized per-row config (replaces same-named keys in `app_data`)
- `pd_audit_log`: append-only audit trail (RLS restricts to INSERT+SELECT for anon)
- `pd_sku_history`: per-change SKU history
- `app_data`: Key-value config (remaining keys: `pd_logistics`, `pd_wireframe`, `pd_users`, `pd_sessions`, `pd_email_config`, etc.)
- `pd_sync`: Realtime notifications for `app_data` key changes (not used for normalized tables)
- `pd_backups`: 7-day rolling daily backups

## Edge Functions
- `login` — server-side password verification + rate limiting; client uses with anon JWT
- `reset-password` — token request + reset (server-stored tokens)
- `claude-chat` — proxies to Anthropic API (needs `ANTHROPIC_API_KEY` env)
- `batch-import` — atomic bulk SKU upsert; called by `confirmImport` with fallback to legacy `_doSaveSKUs`

## Critical Code Patterns
- Per-row save functions (`dbSaveBrands`, `dbSaveCategories`, `dbSaveThresholds`, `dbSaveCommissions`, `dbSaveSKU`, `dbDeleteSKU`) write directly to their tables; failures throw rather than silently writing to blobs
- LOAD functions (`dbLoadAllBrands`, etc.) still have blob → table migration logic as a defense-in-depth one-time migration path
- `invalidateCalcCache()`: MUST be called before ANY render that uses calcSKU
- `save('skus')`: Debounced for edits, `save('skus',{immediate:true})` for critical ops
- All critical operations (delete, archive, add, tags) use immediate save
- Audit log saves immediately (not debounced)
- Session check before data load on init
- `_dataReady` must be true in ALL init paths (login, reset, valid session)

## Testing
- `npm test` runs all 222+ Vitest tests
- Tests in `tests/calc/` use copy-of-source pattern with `SYNC NOTE` comments pointing at the production line in `index.html`
- `tests/sync-check.test.js` enforces those copies stay in sync by asserting the production strings literally appear in `index.html`
- `tests/edge-functions/` tests Deno Edge Function code via the extracted pure-JS helpers (e.g., `validate.ts`)
- WF engine internals (`sanitizeExpr`, `runWFEngine`) are tested with synthetic rule sets — the user-editable `WF.myntra` formulas are not exercised because they vary per user

## Known Limitations
- SHA-256 password hashing without salt for legacy hashes (server-side `login` Edge Function uses salted hashes for new passwords)
- Supabase anon key exposed in client (expected for SPA)
- Session cache is per-tab, not per-user (single-user app)
- localStorage used only for EmailJS template config (browser-local on purpose)
- No undo for permanent delete (only archive has undo via reinstate)
- Myntra branch of `calcSKU` is tested at the WF-engine and wrapper level, but specific output values depend on the user's editable wireframe rules so end-to-end Myntra calcs aren't snapshot-tested

## Do NOT
- Remove `invalidateCalcCache()` calls before render functions
- Make saves fire-and-forget for critical operations (delete, archive, add)
- Set `_dataReady=true` before migrations complete
- Store images in the database (feature removed)
- Use `event: '*'` on Supabase Realtime for app_data (WAL bloat)
- Write to `app_data` blobs for normalized data (brands, categories, commissions, thresholds, SKUs) — the per-row tables are the source of truth
- Hand-edit copied functions in `tests/calc/` without also updating the source in `index.html`; `tests/sync-check.test.js` will fail loudly if they drift
