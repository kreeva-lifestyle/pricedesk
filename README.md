# PriceDesk

[![CI](https://github.com/kreeva-lifestyle/pricedesk/actions/workflows/ci.yml/badge.svg)](https://github.com/kreeva-lifestyle/pricedesk/actions/workflows/ci.yml)
[![Deploy](https://github.com/kreeva-lifestyle/pricedesk/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/kreeva-lifestyle/pricedesk/actions/workflows/deploy.yml)

Marketplace pricing manager for Indian fashion e-commerce (Myntra, Ajio, Amazon).
Calculates per-SKU MRP / seller price / commission / payout / profit using
configurable wireframe formulas and per-marketplace fee tables.

Live: <https://pricing.aryadesigns.co.in>

## Stack

- **Frontend:** Single-file SPA (`index.html`), built with Vite, hosted on GitHub Pages
- **Backend:** Supabase (Postgres + Realtime + Edge Functions)
- **Tests:** Vitest (222+ unit tests covering calc engine and Edge Function validation)
- **CI:** GitHub Actions runs tests + build on every PR; deploy on merge to `main`

## Quick start

```bash
# Use the same Node version as CI
nvm use            # picks up .nvmrc (Node 22)

npm install        # one-time
npm test           # run all 222 tests
npm run build      # produce dist/ (what GitHub Pages serves)
npm run preview    # serve dist/ locally to verify the build
npm run test:watch # iterate on tests
```

## Repo layout

```
index.html                          The whole app
vite.config.js                      Build config (passthrough, no minification)
package.json                        Vite + Vitest devDeps
tests/
  smoke.test.js                     Vitest sanity test
  sync-check.test.js                Asserts copied production strings still
                                    match index.html (drift detection)
  calc/                             Pure-function tests for the calc engine
  edge-functions/                   Edge Function validation tests
supabase/
  functions/                        Deno Edge Functions
    login/                          Server-side password verify + rate limit
    reset-password/                 Token issuance + reset
    claude-chat/                    Anthropic API proxy
    batch-import/                   Atomic bulk SKU upsert
  migrations/                       SQL schemas applied to production
.github/workflows/
  ci.yml                            Tests + build on every PR
  deploy.yml                        Builds + deploys dist/ on push to main
  backup.yml                        Daily DB backup (midnight IST, 7-day rolling)
CLAUDE.md                           Architecture notes for AI/dev sessions
```

## Conventions

- All money in INR (₹), formatted with `toLocaleString('en-IN')`
- GST: 5% under ₹2,500 customer-paid, 18% at or above
- "Seller Price" not "Selling Price" (renamed)
- Style ID is Myntra-only
- "STOCK OUT" tag auto-applied on archive

See `CLAUDE.md` for the full architecture notes, database schema, and "do-not" list.

## Editing the calc engine

Calculation functions (`autoGST`, `getMyntraComm`, `getMynFwd/Ret/Coll`, `calcSKU`,
`calcMyntraFull`, `runWFEngine`, `sanitizeExpr`) live inline in `index.html`. Tests
in `tests/calc/` keep verbatim copies with `SYNC NOTE` comments pointing at the
original line. **If you change any of these in `index.html`, update the matching
test copy.** `tests/sync-check.test.js` will fail loudly if they drift.

## License

Private — proprietary to Kreeva Lifestyle.
