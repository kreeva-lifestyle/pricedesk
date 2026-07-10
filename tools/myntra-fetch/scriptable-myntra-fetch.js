// Myntra live-price fetcher for iPhone — runs in the free "Scriptable" app.
//
// WHY: Myntra blocks cloud-server requests but trusts phones on normal
// mobile/Wi-Fi connections. This script does the same job as the laptop tool
// (tools/myntra-fetch/fetch-prices.mjs): read your active Myntra SKUs from
// Supabase, fetch each product page from THIS phone's connection, read the
// selling price (or detect Out of stock), and write the results to the same
// store PriceDesk displays — the "Myntra ₹" column and the progress banner
// update live on every device while it runs.
//
// HOW TO USE (see tools/myntra-fetch/README.md "Run from your iPhone"):
//   1. Install "Scriptable" from the App Store (free).
//   2. New script → paste this whole file → name it "Myntra Fetch".
//   3. Tap ▶. Keep Scriptable open with the screen on until it says Done
//      (~25 min for ~1,000 styles; plug the phone in).
// Set LIMIT = 20 below for a quick first test, then back to 0 for all.
//
// The price parser below is a copy of tools/myntra-fetch/parse.mjs — kept in
// sync by tests/edge-functions/myntra-fetch-scriptable.test.js.

// ── Config (already filled in — nothing to change) ─────────────────────────
const SUPABASE_URL = "https://fcmesdnagvrdmjzzuwue.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjbWVzZG5hZ3ZyZG1qenp1d3VlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNjM4NTgsImV4cCI6MjA4OTczOTg1OH0.fS1ecV898Dmrka6hr3R0RE6gcKlneWUPbDyDPv30_qU";
const PACING_MS = 1200;   // gap between product pages (gentle on Myntra)
const LIMIT = 0;          // 0 = all styles; set 20 for a quick test run

const LIVE_KEY = "pd_live_prices";
const STATUS_KEY = "pd_live_status";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// ── Price parser (copy of parse.mjs — keep in sync) ─────────────────────────
function numeric(v) {
  if (v && typeof v === "object") {
    const o = v;
    return numeric(o.value ?? o.amount ?? o.price);
  }
  const n = typeof v === "string" ? Number(v.replace(/[,\s₹]/g, "")) : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) return null;
  return n;
}

function mrpNear(html) {
  const m = html.match(/"mrp"\s*:\s*(\d+(?:\.\d+)?)/);
  return m ? numeric(m[1]) : null;
}

function deepFindPrice(root) {
  const PRICE_KEYS = ["discounted", "discountedPrice", "sellingPrice", "finalPrice", "salePrice"];
  const seen = new Set();
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < 20000) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    visited++;
    const o = node;
    const priceHost = (o.price && typeof o.price === "object" && !Array.isArray(o.price))
      ? o.price
      : o;
    for (const k of PRICE_KEYS) {
      if (k in priceHost) {
        const price = numeric(priceHost[k]);
        if (price != null) {
          const mrp = numeric(priceHost.mrp ?? o.mrp ?? priceHost.mrpPrice ?? o.mrpPrice);
          return { price, mrp };
        }
      }
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

function balancedObjectAfter(html, from) {
  const braceStart = html.indexOf("{", from);
  if (braceStart === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(braceStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const STATE_MARKERS = [
  "window.__myx",
  "window.__myxRedux",
  "__INITIAL_STATE__",
  "__PRELOADED_STATE__",
  "__NEXT_DATA__",
  '"pdpData"',
];

function parseMyntraPrice(html) {
  if (!html || typeof html !== "string") return null;

  const ldBlocks = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ) || [];
  for (const block of ldBlocks) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const data = JSON.parse(body);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || !/product/i.test(String(node["@type"] || ""))) continue;
        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const price = numeric(
          (offers && (offers.price ?? offers.lowPrice)) ??
            (offers && offers.priceSpecification && offers.priceSpecification.price),
        );
        if (price != null) return { price, mrp: mrpNear(html), strategy: "json-ld" };
      }
    } catch {
      // malformed block — fall through to the next strategy
    }
  }

  for (const marker of STATE_MARKERS) {
    const at = html.indexOf(marker);
    if (at === -1) continue;
    const obj = balancedObjectAfter(html, at + marker.length);
    if (!obj) continue;
    const found = deepFindPrice(obj);
    if (found) return { price: found.price, mrp: found.mrp ?? mrpNear(html), strategy: "state" };
  }

  const rawKeys = ["discounted", "sellingPrice", "finalPrice", "salePrice"];
  for (const k of rawKeys) {
    const m = html.match(new RegExp(`"${k}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
    if (m) {
      const price = numeric(m[1]);
      if (price != null) return { price, mrp: mrpNear(html), strategy: "regex" };
    }
  }

  const meta = html.match(
    /<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]*content=["']([\d.,]+)["']/i,
  ) || html.match(
    /<meta[^>]+content=["']([\d.,]+)["'][^>]*(?:property|name)=["'](?:og:price:amount|product:price:amount)["']/i,
  );
  if (meta) {
    const price = numeric(meta[1]);
    if (price != null) return { price, mrp: mrpNear(html), strategy: "meta" };
  }

  const dom = html.match(/pdp-price[^>]*>\s*(?:<strong[^>]*>)?\s*(?:₹|Rs\.?)?\s*([\d,]+)/i);
  if (dom) {
    const price = numeric(dom[1]);
    if (price != null) return { price, mrp: mrpNear(html), strategy: "dom" };
  }

  return null;
}

function isOutOfStock(html) {
  if (!html || typeof html !== "string") return false;
  if (/"availability"\s*:\s*"[^"]*(out[_\s]?of[_\s]?stock|sold[_\s]?out)"/i.test(html)) return true;
  if (/"attributeCode"\s*:\s*"SA_XT_OOS"/.test(html)) return true;
  if (/this product is currently sold out|size-buttons-out-of-stock|pdp-out-of-stock/i.test(html)) return true;
  return false;
}

function fingerprintHtml(html) {
  const h = typeof html === "string" ? html : "";
  const titleM = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const priceKeys = ["discounted", "sellingPrice", "finalPrice", "salePrice", "mrp"]
    .filter((k) => new RegExp(`"${k}"\\s*:`).test(h));
  const blockedSignals = /captcha|px-captcha|perimeterx|access denied|unusual traffic|are you a human|request unsuccessful|incapsula|cf-browser-verification/i;
  return {
    bytes: h.length,
    title: titleM ? titleM[1].trim().slice(0, 120) : null,
    hasJsonLd: /application\/ld\+json/i.test(h),
    hasState: STATE_MARKERS.some((m) => h.includes(m)),
    hasPdpPrice: /pdp-price/i.test(h),
    priceKeys,
    looksBlocked: blockedSignals.test(h) || h.length < 2000,
  };
}

function fingerprintSummary(fp) {
  if (fp.looksBlocked) {
    return `page looks blocked/challenged (${fp.bytes}b${fp.title ? `, "${fp.title}"` : ""})`;
  }
  const markers = [];
  if (fp.hasJsonLd) markers.push("json-ld");
  if (fp.hasState) markers.push("state");
  if (fp.hasPdpPrice) markers.push("pdp-price");
  if (fp.priceKeys.length) markers.push("keys:" + fp.priceKeys.join("/"));
  return `no price found (${fp.bytes}b; ${markers.length ? markers.join(", ") : "no known price markers"})`;
}

// ── Supabase via REST (Scriptable's Request; no libraries) ─────────────────
async function sbRequest(path, { method = "GET", body = null, prefer = null } = {}) {
  const r = new Request(`${SUPABASE_URL}/rest/v1/${path}`);
  r.method = method;
  r.headers = {
    "apikey": SUPABASE_ANON,
    "Authorization": `Bearer ${SUPABASE_ANON}`,
    "Content-Type": "application/json",
    ...(prefer ? { "Prefer": prefer } : {}),
  };
  if (body != null) r.body = JSON.stringify(body);
  const text = await r.loadString();
  const status = r.response && r.response.statusCode;
  if (status && status >= 400) throw new Error(`Supabase ${method} ${path} → HTTP ${status}: ${String(text).slice(0, 120)}`);
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function sbUpsert(table, row) {
  await sbRequest(`${table}?on_conflict=key`, {
    method: "POST",
    body: [row],
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function readBlob(key) {
  const rows = await sbRequest(`app_data?key=eq.${key}&select=value`);
  const v = rows && rows[0] && rows[0].value;
  return (v && typeof v === "object") ? v : {};
}

async function writeLivePrices(value) {
  const now = new Date().toISOString();
  await sbUpsert("app_data", { key: LIVE_KEY, value, updated_at: now });
  // pd_sync ping → every open PriceDesk refreshes in realtime
  try { await sbUpsert("pd_sync", { key: LIVE_KEY, updated_at: now }); } catch (e) { /* cosmetic */ }
}

async function writeStatus(status) {
  try {
    const now = new Date().toISOString();
    await sbUpsert("app_data", { key: STATUS_KEY, value: { ...status, ts: Date.now() }, updated_at: now });
    await sbUpsert("pd_sync", { key: STATUS_KEY, updated_at: now });
  } catch (e) { /* status is cosmetic — never break the run */ }
}

// ── Load SKUs (active Myntra styles, numeric ids, deduped) ──────────────────
async function loadMyntraStyleIds() {
  const brands = await sbRequest("pd_brands?select=id,model");
  const brandModel = {};
  for (const b of brands || []) brandModel[b.id] = b.model || "myntra";
  const ids = [];
  const seen = {};
  for (let offset = 0; ; offset += 1000) {
    const page = await sbRequest(`pd_skus_v2?select=style_id,brand_id,archived&limit=1000&offset=${offset}`);
    if (!page || !page.length) break;
    for (const r of page) {
      const sid = String(r.style_id || "").trim();
      if (r.archived) continue;
      if (brandModel[r.brand_id] !== "myntra") continue;
      if (!/^\d{4,12}$/.test(sid)) continue;
      if (!seen[sid]) { seen[sid] = true; ids.push(sid); }
    }
    if (page.length < 1000) break;
  }
  return ids;
}

// ── Fetch one Myntra product page from this phone ───────────────────────────
async function fetchStyle(styleId) {
  try {
    const r = new Request(`https://www.myntra.com/${styleId}`);
    r.headers = {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
    };
    r.timeoutInterval = 20;
    const html = await r.loadString();
    if (isOutOfStock(html)) {
      const p = parseMyntraPrice(html);
      return { ok: true, oos: true, mrp: p ? (p.mrp != null ? p.mrp : p.price) : null };
    }
    const parsed = parseMyntraPrice(html);
    if (parsed) return { ok: true, price: parsed.price, mrp: parsed.mrp };
    return { ok: false, error: fingerprintSummary(fingerprintHtml(html)) };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${e.message}` };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sourceName() {
  try { return "iPhone (" + Device.name() + ")"; } catch (e) { return "iPhone"; }
}

// ── Main run — mirrors the laptop tool's runFetch ───────────────────────────
async function main() {
  console.log("Loading Myntra SKUs from Supabase…");
  let ids = await loadMyntraStyleIds();
  if (LIMIT > 0) ids = ids.slice(0, LIMIT);
  if (!ids.length) { console.log("No active Myntra SKUs found."); return { ok: 0, fail: 0, total: 0 }; }
  const live = await readBlob(LIVE_KEY); // merge — don't clobber other styles
  const mins = Math.max(1, Math.round((ids.length * PACING_MS) / 60000));
  console.log(`Fetching ${ids.length} styles from this iPhone (~${mins} min). Keep Scriptable open.`);

  let ok = 0, fail = 0, oos = 0, done = 0;
  const startedAt = new Date().toISOString();
  const src = sourceName();
  await writeStatus({ running: true, total: ids.length, done: 0, ok: 0, fail: 0, startedAt, source: src });

  for (const sid of ids) {
    const started = Date.now();
    const r = await fetchStyle(sid);
    if (r.ok && r.oos) {
      live[sid] = { oos: true, mrp: r.mrp != null ? r.mrp : null, ts: Date.now() };
      ok++; oos++;
    } else if (r.ok && typeof r.price === "number") {
      live[sid] = { price: r.price, mrp: r.mrp != null ? r.mrp : null, ts: Date.now() };
      ok++;
    } else {
      fail++;
      // Keep any previously-good price; only stamp an error if we have none.
      if (!live[sid] || live[sid].price == null) {
        live[sid] = { price: null, mrp: null, ts: Date.now(), err: r.error || "fetch failed" };
      }
    }
    done++;
    if (done % 10 === 0 || done === ids.length) console.log(`  ${done}/${ids.length}  (${ok} ok, ${fail} failed)`);
    if (done % 50 === 0) await writeStatus({ running: true, total: ids.length, done, ok, fail, startedAt, source: src });
    if (done % 100 === 0) await writeLivePrices(live); // checkpoint — an iOS kill loses little
    const elapsed = Date.now() - started;
    if (elapsed < PACING_MS) await sleep(PACING_MS - elapsed);
  }

  await writeLivePrices(live);
  await writeStatus({ running: false, total: ids.length, done, ok, fail, startedAt, finishedAt: new Date().toISOString(), source: src });

  const summary = `Done: ${ok} fetched${oos ? ` (${oos} out of stock)` : ""}, ${fail} failed of ${ids.length}.`;
  console.log(summary);
  console.log("PriceDesk's Myntra ₹ column is updated on all devices.");
  try {
    const a = new Alert();
    a.title = "Myntra Fetch";
    a.message = summary;
    a.addAction("OK");
    await a.present();
  } catch (e) { /* Alert only exists in Scriptable */ }
  return { ok, fail, oos, total: ids.length };
}

// Scriptable defines the global `config`; the Node test harness does not.
// In Scriptable → run immediately. In tests → internals are collected by the
// harness (it appends a `return __exports` when evaluating this file).
const __exports = {
  parseMyntraPrice, isOutOfStock, deepFindPrice, fingerprintHtml, fingerprintSummary,
  loadMyntraStyleIds, fetchStyle, main,
};
if (typeof config !== "undefined") {
  await main();
  try { Script.complete(); } catch (e) { /* Scriptable only */ }
}
