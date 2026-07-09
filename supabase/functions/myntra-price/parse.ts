// Price-parsing + input-validation logic for the myntra-price Edge Function.
// Extracted into its own file so Vitest (Node) can import it
// without pulling in Deno runtime types.
//
// Myntra PDPs expose the selling price in several redundant places; parsing
// tries them from most- to least-structured so a markup change in one spot
// doesn't break the whole scraper:
//   1. json-ld  — <script type="application/ld+json"> Product offers.price
//   2. state    — window.__myx / pdpData / __INITIAL_STATE__ embedded JSON,
//                 deep-walked for a price object (discounted/sellingPrice/…)
//   3. regex    — raw price keys anywhere in embedded state
//   4. meta     — <meta property="og:price:amount" | "product:price:amount">
//   5. dom      — rendered <span class="pdp-price"><strong>₹2951</strong>
// The gateway JSON API (myntra.com/gateway/v2/product/<id>) is parsed by
// parseGatewayProduct with the same deep-walk since its schema isn't
// versioned for us.

export const MAX_STYLE_IDS = 10;

export interface ParsedPrice {
  price: number;
  mrp: number | null;
  strategy: string;
}

export interface StyleIdValidation {
  ok: boolean;
  ids?: string[];
  invalid?: string[];
  error?: string;
}

// Prices are INR integers on Myntra; anything non-finite, non-positive, or
// absurdly large is a parse artifact, not a price.
function numeric(v: unknown): number | null {
  if (v && typeof v === "object") {
    // Some payloads wrap the amount: { value: 2951 } / { amount: 2951 }
    const o = v as Record<string, unknown>;
    return numeric(o.value ?? o.amount ?? o.price);
  }
  const n = typeof v === "string" ? Number(v.replace(/[,\s₹]/g, "")) : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) return null;
  return n;
}

export function validateStyleIds(input: unknown): StyleIdValidation {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "styleIds must be a non-empty array" };
  }
  if (input.length > MAX_STYLE_IDS) {
    return { ok: false, error: `Max ${MAX_STYLE_IDS} styleIds per request` };
  }
  // Malformed ids become per-id failures rather than rejecting the whole
  // batch — one typo'd Style ID must not starve the 9 valid ones beside it.
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const raw of input) {
    const id = String(raw).trim();
    // Myntra style ids are numeric (7-8 digits today); keep a loose band so
    // neither old short ids nor future longer ones get rejected.
    if (!/^\d{4,12}$/.test(id)) {
      invalid.push(String(raw).slice(0, 40));
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  if (!ids.length) {
    return { ok: false, invalid, error: "No valid style ids in request" };
  }
  return { ok: true, ids, invalid };
}

// First "mrp": N anywhere in the page's embedded state — used to pair an MRP
// with strategies that only yield the selling price.
function mrpNear(html: string): number | null {
  const m = html.match(/"mrp"\s*:\s*(\d+(?:\.\d+)?)/);
  return m ? numeric(m[1]) : null;
}

// Deep-walk any parsed object for a price. Accepts either a price sub-object
// ({discounted|sellingPrice|finalPrice|...}) or a node carrying those keys
// directly, and pairs an MRP from the same node when present.
export function deepFindPrice(root: unknown): { price: number; mrp: number | null } | null {
  const PRICE_KEYS = ["discounted", "discountedPrice", "sellingPrice", "finalPrice", "salePrice"];
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length && visited < 20000) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    visited++;
    const o = node as Record<string, unknown>;

    // Node carries a price key directly (or under a nested `price` object)
    const priceHost = (o.price && typeof o.price === "object" && !Array.isArray(o.price))
      ? o.price as Record<string, unknown>
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

// Find a balanced {...} JSON object starting at the first `{` at/after a
// marker string. Handles braces inside string values.
function balancedObjectAfter(html: string, from: number): Record<string, unknown> | null {
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

// Markers that precede an embedded-state JSON object on a Myntra PDP. Order
// matters only for efficiency; each is deep-walked for a price.
const STATE_MARKERS = [
  "window.__myx",
  "window.__myxRedux",
  "__INITIAL_STATE__",
  "__PRELOADED_STATE__",
  "__NEXT_DATA__",
  '"pdpData"',
];

export function parseMyntraPrice(html: string): ParsedPrice | null {
  if (!html || typeof html !== "string") return null;

  // 1. JSON-LD Product offers (most stable when present)
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
            (offers && offers.priceSpecification && (offers.priceSpecification as Record<string, unknown>).price),
        );
        if (price != null) return { price, mrp: mrpNear(html), strategy: "json-ld" };
      }
    } catch {
      // malformed block — fall through to the next strategy
    }
  }

  // 2. Embedded SPA state — deep-walk whichever marker is present
  for (const marker of STATE_MARKERS) {
    const at = html.indexOf(marker);
    if (at === -1) continue;
    const obj = balancedObjectAfter(html, at + marker.length);
    if (!obj) continue;
    const found = deepFindPrice(obj);
    if (found) return { price: found.price, mrp: found.mrp ?? mrpNear(html), strategy: "state" };
  }

  // 3. Raw embedded-state keys anywhere in the HTML
  const rawKeys = ["discounted", "sellingPrice", "finalPrice", "salePrice"];
  for (const k of rawKeys) {
    const m = html.match(new RegExp(`"${k}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
    if (m) {
      const price = numeric(m[1]);
      if (price != null) return { price, mrp: mrpNear(html), strategy: "regex" };
    }
  }

  // 4. Open-Graph / product meta tags
  const meta = html.match(
    /<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]*content=["']([\d.,]+)["']/i,
  ) || html.match(
    /<meta[^>]+content=["']([\d.,]+)["'][^>]*(?:property|name)=["'](?:og:price:amount|product:price:amount)["']/i,
  );
  if (meta) {
    const price = numeric(meta[1]);
    if (price != null) return { price, mrp: mrpNear(html), strategy: "meta" };
  }

  // 5. Rendered DOM price node
  const dom = html.match(/pdp-price[^>]*>\s*(?:<strong[^>]*>)?\s*(?:₹|Rs\.?)?\s*([\d,]+)/i);
  if (dom) {
    const price = numeric(dom[1]);
    if (price != null) return { price, mrp: mrpNear(html), strategy: "dom" };
  }

  return null;
}

// Defensive deep-walk of the gateway API response.
export function parseGatewayProduct(data: unknown): ParsedPrice | null {
  const found = deepFindPrice(data);
  return found ? { price: found.price, mrp: found.mrp, strategy: "gateway" } : null;
}

export interface HtmlFingerprint {
  bytes: number;
  title: string | null;
  hasJsonLd: boolean;
  hasState: boolean;
  hasPdpPrice: boolean;
  priceKeys: string[];
  looksBlocked: boolean;
}

// Non-destructive summary of a page we FAILED to parse — surfaced in the
// error so we can tell "blocked by a bot-wall" from "real page, new markup"
// without eyeballing megabytes of HTML.
export function fingerprintHtml(html: string): HtmlFingerprint {
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

// One-line human summary of a fingerprint for the error message / tooltip.
export function fingerprintSummary(fp: HtmlFingerprint): string {
  if (fp.looksBlocked) {
    return `page looks blocked/challenged (${fp.bytes}b${fp.title ? `, "${fp.title}"` : ""})`;
  }
  const markers: string[] = [];
  if (fp.hasJsonLd) markers.push("json-ld");
  if (fp.hasState) markers.push("state");
  if (fp.hasPdpPrice) markers.push("pdp-price");
  if (fp.priceKeys.length) markers.push("keys:" + fp.priceKeys.join("/"));
  return `no price found (${fp.bytes}b; ${markers.length ? markers.join(", ") : "no known price markers"})`;
}

// A capped, price-focused excerpt for the debug path: title + a window around
// the first price-ish keyword, so the exact embedding can be inspected.
export function debugSnippet(html: string, max = 1800): string {
  const h = typeof html === "string" ? html : "";
  const titleM = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const idx = h.search(/"(?:discounted|sellingPrice|finalPrice|mrp)"\s*:|pdp-price|og:price:amount/i);
  let body: string;
  if (idx >= 0) {
    body = h.slice(Math.max(0, idx - 200), idx + max);
  } else {
    body = h.slice(0, max);
  }
  return `[title] ${titleM ? titleM[1].trim() : "(none)"}\n[excerpt] ${body}`;
}
