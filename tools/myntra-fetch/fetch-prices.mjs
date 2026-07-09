#!/usr/bin/env node
// Self-hosted Myntra live-price fetcher for PriceDesk.
//
// WHY: Myntra serves datacenter IPs (Supabase/cloud) a "Site Maintenance"
// stub, so the in-app "Myntra ₹" button can't scrape prices without a paid
// proxy. This script runs on YOUR laptop — a residential IP Myntra trusts —
// so it gets the real page, parses the price with the same logic as the app,
// and writes it straight into the shared store the app already reads. Every
// open app/phone then updates live.
//
// USAGE: see README.md. TL;DR: `npm install` then `npm start`.
// Run it on as many laptops as you like — whichever is on does the run;
// they write the same store (last run wins), so overlap is harmless.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { fingerprintHtml, fingerprintSummary, isOutOfStock, parseMyntraPrice } from "./parse.mjs";
import { validateCredentials } from "./config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────
// Reads config.json (copy from config.example.json), falling back to env vars.
function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
  } catch {
    /* no config.json — rely on env / defaults */
  }
  let creds;
  try {
    creds = validateCredentials(
      process.env.SUPABASE_URL || file.SUPABASE_URL,
      process.env.SUPABASE_ANON || file.SUPABASE_ANON,
    );
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  return {
    SUPABASE_URL: creds.url,
    SUPABASE_ANON: creds.anon,
    PACING_MS: Number(process.env.PACING_MS || file.PACING_MS || 1500),
    MAX_CONCURRENCY: Number(process.env.MAX_CONCURRENCY || file.MAX_CONCURRENCY || 2),
    LIMIT: Number(process.env.LIMIT || file.LIMIT || 0), // 0 = all
  };
}

const LIVE_KEY = "pd_live_prices";
const STATUS_KEY = "pd_live_status";
// Browser-like headers so Myntra serves the full PDP (matches the Edge Function).
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchStyle(styleId) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://www.myntra.com/${styleId}`, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const html = await resp.text();
    // Sold-out products have no selling price (only MRP) — flag OOS instead of
    // reporting the MRP as a bogus price.
    if (isOutOfStock(html)) {
      const p = parseMyntraPrice(html);
      const mrp = p ? (p.mrp != null ? p.mrp : p.price) : null;
      return { ok: true, oos: true, mrp };
    }
    const parsed = parseMyntraPrice(html);
    if (parsed) return { ok: true, price: parsed.price, mrp: parsed.mrp, strategy: parsed.strategy };
    return { ok: false, error: fingerprintSummary(fingerprintHtml(html)) };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// Load every active Myntra SKU (numeric styleId) — pages pd_skus_v2 by 1000,
// mirrors the app's loader. Joins brand.model from pd_brands.
async function loadMyntraStyleIds(db) {
  const brandById = new Map();
  {
    const { data, error } = await db.from("pd_brands").select("id,model");
    if (error) throw new Error(`pd_brands read failed: ${error.message}`);
    for (const b of data || []) brandById.set(b.id, b.model || "myntra");
  }
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("pd_skus_v2")
      .select("style_id,brand_id,archived")
      .range(from, from + 999);
    if (error) throw new Error(`pd_skus_v2 read failed: ${error.message}`);
    if (!data || !data.length) break;
    for (const r of data) {
      const sid = String(r.style_id || "").trim();
      if (r.archived) continue;
      if (brandById.get(r.brand_id) !== "myntra") continue;
      if (!/^\d{4,12}$/.test(sid)) continue;
      ids.add(sid);
    }
    if (data.length < 1000) break;
  }
  return [...ids];
}

async function readLivePrices(db) {
  const { data } = await db.from("app_data").select("value").eq("key", LIVE_KEY).single();
  return (data && data.value && typeof data.value === "object") ? data.value : {};
}

async function ping(db, key) {
  // Ping pd_sync so every open app/phone refreshes in realtime — same
  // mechanism the app uses (index.html dbSet).
  await db.from("pd_sync").upsert({ key, updated_at: new Date().toISOString() }, { onConflict: "key" })
    .then(() => {}, () => {});
}

async function writeLivePrices(db, value) {
  const { error } = await db
    .from("app_data")
    .upsert({ key: LIVE_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`write failed: ${error.message}`);
  await ping(db, LIVE_KEY);
}

// Report run progress into pd_live_status so the app can show a live banner
// (and detect "laptop turned off" via a stale heartbeat: `ts`). Best-effort —
// a status write must never break the actual price run.
async function writeStatus(db, status) {
  try {
    const value = { ...status, ts: Date.now() };
    await db.from("app_data").upsert({ key: STATUS_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    await ping(db, STATUS_KEY);
  } catch { /* ignore — status is cosmetic */ }
}

async function main() {
  const cfg = loadConfig();
  const db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON, { auth: { persistSession: false } });

  console.log("Loading Myntra SKUs from Supabase…");
  let ids = await loadMyntraStyleIds(db);
  if (cfg.LIMIT > 0) ids = ids.slice(0, cfg.LIMIT);
  if (!ids.length) {
    console.log("No active Myntra SKUs with numeric Style IDs found. Nothing to do.");
    return;
  }
  const live = await readLivePrices(db); // merge — don't clobber other styles
  const mins = Math.max(1, Math.round((ids.length * cfg.PACING_MS) / cfg.MAX_CONCURRENCY / 60000));
  console.log(`Fetching ${ids.length} styles from this machine's IP (~${mins} min)…`);

  let ok = 0, fail = 0, oos = 0, done = 0;
  const errSample = {};
  const queue = [...ids];
  const startedAt = new Date().toISOString();
  const src = hostname() || "a laptop";
  // Announce the run so the app shows a live progress banner.
  await writeStatus(db, { running: true, total: ids.length, done: 0, ok: 0, fail: 0, startedAt, source: src });

  const worker = async () => {
    while (queue.length) {
      const sid = queue.shift();
      const started = Date.now();
      const r = await fetchStyle(sid);
      if (r.ok && r.oos) {
        // Sold out on Myntra — record it (the app shows "Out of stock").
        live[sid] = { oos: true, mrp: r.mrp != null ? r.mrp : null, ts: Date.now() };
        ok++; oos++;
      } else if (r.ok && typeof r.price === "number") {
        live[sid] = { price: r.price, mrp: r.mrp != null ? r.mrp : null, ts: Date.now() };
        ok++;
      } else {
        fail++;
        const key = String(r.error || "fetch failed").slice(0, 80);
        errSample[key] = (errSample[key] || 0) + 1;
        // Keep any previously-good price; only stamp an error if we have none.
        if (!live[sid] || live[sid].price == null) {
          live[sid] = { price: null, mrp: null, ts: Date.now(), err: r.error || "fetch failed" };
        }
      }
      done++;
      if (done % 25 === 0 || done === ids.length) {
        process.stdout.write(`\r  ${done}/${ids.length}  (${ok} ok, ${fail} failed)   `);
      }
      // Periodic checkpoint so a long run isn't lost if the laptop sleeps, and
      // a status heartbeat so the app's banner shows progress (and can detect
      // a laptop that went off mid-run via the stale `ts`).
      if (done % 50 === 0) {
        await writeStatus(db, { running: true, total: ids.length, done, ok, fail, startedAt, source: src });
      }
      if (done % 200 === 0) await writeLivePrices(db, live);
      const elapsed = Date.now() - started;
      if (elapsed < cfg.PACING_MS) await sleep(cfg.PACING_MS - elapsed);
    }
  };

  let crashed = null;
  try {
    await Promise.all(Array.from({ length: Math.max(1, cfg.MAX_CONCURRENCY) }, worker));
  } catch (e) {
    crashed = e;
  }
  await writeLivePrices(db, live);
  // Final status — running:false so the app switches the banner to
  // "last updated N ago". Always written, even if the run threw.
  await writeStatus(db, {
    running: false, total: ids.length, done, ok, fail,
    startedAt, finishedAt: new Date().toISOString(), source: src,
  });
  if (crashed) throw crashed;

  console.log(`\nDone: ${ok} fetched${oos?` (${oos} out of stock)`:''}, ${fail} failed of ${ids.length}.`);
  if (fail) {
    const top = Object.entries(errSample).sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log("Most common errors:");
    for (const [m, n] of top) console.log(`  ${n}×  ${m}`);
    if (top.some(([m]) => /blocked|maintenance/i.test(m))) {
      console.log(
        "\nMany pages look blocked — Myntra may be rate-limiting this IP. Slow down (raise PACING_MS) or run from a different connection.",
      );
    }
  }
  console.log("Prices written to Supabase; the app's Myntra ₹ column updates live.");
}

main().catch((e) => {
  console.error("\nFatal:", e.message);
  process.exit(1);
});
