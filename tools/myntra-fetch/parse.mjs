// Myntra PDP price parser for the self-hosted laptop fetcher (fetch-prices.mjs).
// Myntra serves the selling price in several redundant places; parsing tries
// them most- to least-structured so a markup change in one spot doesn't break
// the whole thing: JSON-LD → embedded SPA state (window.__myx /
// __INITIAL_STATE__ / pdpData, deep-walked) → raw regex keys → og:price meta →
// rendered pdp-price DOM node. Unit-tested in
// tests/edge-functions/myntra-fetch-parse.test.js.

// Prices are INR integers on Myntra; anything non-finite, non-positive, or
// absurdly large is a parse artifact, not a price.
function numeric(v) {
  if (v && typeof v === "object") {
    // Some payloads wrap the amount: { value: 2951 } / { amount: 2951 }
    const o = v;
    return numeric(o.value ?? o.amount ?? o.price);
  }
  const n = typeof v === "string" ? Number(v.replace(/[,\s₹]/g, "")) : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) return null;
  return n;
}

// First "mrp": N anywhere in the page's embedded state — used to pair an MRP
// with strategies that only yield the selling price.
function mrpNear(html) {
  const m = html.match(/"mrp"\s*:\s*(\d+(?:\.\d+)?)/);
  return m ? numeric(m[1]) : null;
}

// Deep-walk any parsed object for a price. Accepts either a price sub-object
// ({discounted|sellingPrice|finalPrice|...}) or a node carrying those keys
// directly, and pairs an MRP from the same node when present.
export function deepFindPrice(root) {
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

    // Node carries a price key directly (or under a nested `price` object)
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

// Find a balanced {...} JSON object starting at the first `{` at/after a
// marker string. Handles braces inside string values.
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

export function parseMyntraPrice(html) {
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
            (offers && offers.priceSpecification && offers.priceSpecification.price),
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

// Non-destructive summary of a page we FAILED to parse — tells "blocked by a
// bot-wall" from "real page, new markup".
export function fingerprintHtml(html) {
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

// One-line human summary of a fingerprint for the error message.
export function fingerprintSummary(fp) {
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
