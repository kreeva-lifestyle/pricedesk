// myntra-price Edge Function — server-side fetch of live Myntra selling
// prices for the PriceDesk "Myntra ₹" column. The browser cannot fetch
// myntra.com itself (CORS + bot protection), so the client POSTs
// { styleIds: ["40451814", ...] } (max 10 per call) and gets back
// { ok: true, results: [{ styleId, ok, price, mrp, strategy | error }] }.
// Parsing lives in ./parse.ts (pure, unit-tested by Vitest).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  debugSnippet,
  fingerprintHtml,
  fingerprintSummary,
  parseGatewayProduct,
  parseMyntraPrice,
  validateStyleIds,
} from "./parse.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Per-IP rate limit. This function makes outbound requests to myntra.com;
// without a cap it is an open proxy anyone with the anon key could abuse.
// A full catalog refresh (~1000 styles / 10 per call) paces at ~10 calls
// per minute, so 40/min leaves generous headroom for a legitimate user.
const RATE_LIMIT_MAX = 40;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

interface RateRecord { count: number; firstAt: number; }
type RateMap = Record<string, RateRecord>;

function clientIp(req: Request): string {
  // Prefer cf-connecting-ip (set by the edge proxy, not client-forgeable)
  // over x-forwarded-for, whose first hop a client can spoof to dodge the
  // rate limit.
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!SERVICE_ROLE_KEY) return { allowed: true, retryAfterSec: 0 };
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data } = await db.from("app_data").select("value").eq("key", "pd_myntra_rate_limits").single();
    const map: RateMap = (data?.value as RateMap) || {};
    const now = Date.now();
    for (const k of Object.keys(map)) {
      if (now - map[k].firstAt > RATE_LIMIT_WINDOW_MS) delete map[k];
    }
    const rec = map[ip] || { count: 0, firstAt: now };
    if (now - rec.firstAt > RATE_LIMIT_WINDOW_MS) {
      rec.count = 0;
      rec.firstAt = now;
    }
    rec.count++;
    map[ip] = rec;
    await db.from("app_data").upsert(
      { key: "pd_myntra_rate_limits", value: map, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (rec.count > RATE_LIMIT_MAX) {
      const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - rec.firstAt)) / 1000);
      return { allowed: false, retryAfterSec: Math.max(retryAfterSec, 1) };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch (_e) {
    // Fail-open if rate-limit storage is unavailable — better to serve
    // requests than to deny a legitimate user because of a DB hiccup.
    return { allowed: true, retryAfterSec: 0 };
  }
}

// Origin allowlist — see claude-chat for rationale.
const ALLOWED_ORIGINS = new Set([
  "https://pricing.aryadesigns.co.in",
  "https://kreeva-lifestyle.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://pricing.aryadesigns.co.in";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonResponse(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Browser-like headers: Myntra serves the full PDP (with embedded state) to
// regular browsers; a bare Deno fetch UA tends to get challenged instead.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 12_000;
// Cap how much of a response we ingest — a redirect to a hostile host (or a
// broken CDN page) must not balloon function memory.
const MAX_BODY_BYTES = 5_000_000;

// redirect:"follow" can land anywhere; only trust bodies served by Myntra.
function isMyntraHost(finalUrl: string): boolean {
  try {
    const h = new URL(finalUrl).hostname;
    return h === "myntra.com" || h.endsWith(".myntra.com");
  } catch (_e) {
    return false;
  }
}

async function readCapped(resp: Response): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return await resp.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try { await reader.cancel(); } catch (_e) { /* already done */ }
  const buf = new Uint8Array(Math.min(total, MAX_BODY_BYTES));
  let off = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.min(c.byteLength, buf.length - off));
    buf.set(slice, off);
    off += slice.byteLength;
    if (off >= buf.length) break;
  }
  return new TextDecoder().decode(buf);
}

function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": accept,
      "Accept-Language": "en-IN,en;q=0.9",
    },
    redirect: "follow",
    signal: ctl.signal,
  }).finally(() => clearTimeout(timer));
}

interface StyleResult {
  styleId: string;
  ok: boolean;
  price?: number;
  mrp?: number | null;
  strategy?: string;
  error?: string;
  debug?: string;
}

// Parse a JSON body defensively — Myntra's gateway sometimes serves the SPA
// HTML shell (a `<!doctype html>` page) for unknown routes, which would make
// a bare JSON.parse throw the confusing "unexpected token !doctype" error.
function safeJson(text: string): unknown | null {
  const t = text.trimStart();
  if (!t || t[0] === "<") return null; // HTML, not JSON
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

async function fetchStylePrice(styleId: string, debug = false): Promise<StyleResult> {
  let lastError = "";
  let pdpHtml = "";
  // 1. PDP HTML — what a real browser sees; myntra.com/<styleId> redirects
  //    to the canonical product URL.
  try {
    const resp = await fetchWithTimeout(
      `https://www.myntra.com/${styleId}`,
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    );
    if (resp.ok && !isMyntraHost(resp.url)) {
      lastError = "redirected off myntra.com";
    } else if (resp.ok) {
      pdpHtml = await readCapped(resp);
      const parsed = parseMyntraPrice(pdpHtml);
      if (parsed) {
        const out: StyleResult = { styleId, ok: true, price: parsed.price, mrp: parsed.mrp, strategy: parsed.strategy };
        if (debug) out.debug = debugSnippet(pdpHtml);
        return out;
      }
      // Fingerprint the page we couldn't parse so the error is actionable
      lastError = fingerprintSummary(fingerprintHtml(pdpHtml));
    } else {
      lastError = `product page HTTP ${resp.status}`;
    }
  } catch (e) {
    lastError = `product page fetch failed: ${(e as Error).message}`;
  }
  // 2. Gateway JSON API fallback
  try {
    const resp = await fetchWithTimeout(
      `https://www.myntra.com/gateway/v2/product/${styleId}`,
      "application/json",
    );
    if (resp.ok && isMyntraHost(resp.url)) {
      const json = safeJson(await readCapped(resp));
      if (json === null) {
        lastError += "; gateway returned non-JSON (HTML shell)";
      } else {
        const parsed = parseGatewayProduct(json);
        if (parsed) {
          const out: StyleResult = { styleId, ok: true, price: parsed.price, mrp: parsed.mrp, strategy: parsed.strategy };
          if (debug) out.debug = "gateway JSON parsed";
          return out;
        }
        lastError += "; gateway JSON had no price";
      }
    } else if (resp.ok) {
      lastError += "; gateway redirected off myntra.com";
    } else {
      lastError += `; gateway HTTP ${resp.status}`;
    }
  } catch (e) {
    lastError += `; gateway fetch failed: ${(e as Error).message}`;
  }
  const out: StyleResult = { styleId, ok: false, error: lastError };
  if (debug && pdpHtml) out.debug = debugSnippet(pdpHtml);
  return out;
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405, cors);
  }

  try {
    const ip = clientIp(req);
    const gate = await checkRateLimit(ip);
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({ error: `Rate limit exceeded. Try again in ${gate.retryAfterSec}s.` }),
        { status: 429, headers: { ...cors, "Content-Type": "application/json", "Retry-After": String(gate.retryAfterSec) } },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (_e) {
      return jsonResponse({ error: "Body is not valid JSON" }, 400, cors);
    }

    const check = validateStyleIds((body as Record<string, unknown>)?.styleIds);
    if (!check.ok || !check.ids) {
      return jsonResponse({ error: check.error || "Invalid styleIds" }, 400, cors);
    }
    // Opt-in diagnostics: returns a capped page excerpt per style so the
    // exact Myntra markup can be inspected when parsing fails.
    const debug = (body as Record<string, unknown>)?.debug === true;

    // Fetch with small concurrency — fast enough for a 10-id batch without
    // hammering Myntra from a single datacenter IP. Malformed ids come back
    // as per-id failures so the rest of the batch still gets prices.
    const queue = [...check.ids];
    const results: StyleResult[] = (check.invalid || []).map((raw) => ({
      styleId: raw,
      ok: false,
      error: "Invalid style id (must be numeric)",
    }));
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift();
        if (!id) break;
        results.push(await fetchStylePrice(id, debug));
      }
    });
    await Promise.all(workers);

    return jsonResponse({ ok: true, results, fetchedAt: new Date().toISOString() }, 200, cors);
  } catch (error) {
    return jsonResponse({ error: "Unexpected error", message: (error as Error).message }, 500, cors);
  }
});
