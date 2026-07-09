// Price-parsing + input-validation logic for the myntra-price Edge Function.
// Extracted into its own file so Vitest (Node) can import it
// without pulling in Deno runtime types.
//
// Myntra PDPs expose the selling price in several redundant places; parsing
// tries them from most- to least-structured so a markup change in one spot
// doesn't break the whole scraper:
//   1. JSON-LD  — <script type="application/ld+json"> Product offers.price
//   2. __myx    — window.__myx = {...} SPA state, pdpData.price.discounted
//   3. regex    — raw "discounted"/"mrp" keys anywhere in embedded state
//   4. dom      — rendered <span class="pdp-price"><strong>₹2951</strong>
// The gateway JSON API (myntra.com/gateway/v2/product/<id>) is parsed by
// parseGatewayProduct with a defensive deep-walk since its schema is not
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
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
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

// Extract the window.__myx = {...} assignment via balanced-brace scan (the
// object contains "</script>"-free JSON but regex alone can't find its end).
function extractMyx(html: string): Record<string, unknown> | null {
  const marker = html.indexOf("window.__myx");
  if (marker === -1) return null;
  const braceStart = html.indexOf("{", marker);
  if (braceStart === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
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

export function parseMyntraPrice(html: string): ParsedPrice | null {
  if (!html || typeof html !== "string") return null;

  // 1. JSON-LD Product offers
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
        const price = numeric(offers && offers.price);
        if (price != null) return { price, mrp: mrpNear(html), strategy: "json-ld" };
      }
    } catch {
      // malformed block — fall through to the next strategy
    }
  }

  // 2. window.__myx SPA state
  const myx = extractMyx(html);
  if (myx) {
    const pdp = myx.pdpData as Record<string, unknown> | undefined;
    const p = pdp && (pdp.price as Record<string, unknown> | undefined);
    const discounted = numeric(p && (p.discounted ?? p.discountedPrice));
    const mrp = numeric((p && p.mrp) ?? (pdp && pdp.mrp));
    if (discounted != null) return { price: discounted, mrp, strategy: "__myx" };
  }

  // 3. Raw embedded-state keys
  const dm = html.match(/"discounted"\s*:\s*(\d+(?:\.\d+)?)/);
  if (dm) {
    const price = numeric(dm[1]);
    if (price != null) return { price, mrp: mrpNear(html), strategy: "regex" };
  }

  // 4. Rendered DOM price node
  const dom = html.match(/pdp-price[^>]*>\s*(?:<strong[^>]*>)?\s*(?:₹|Rs\.?)?\s*([\d,]+)/i);
  if (dom) {
    const price = numeric(dom[1]);
    if (price != null) return { price, mrp: mrpNear(html), strategy: "dom" };
  }

  return null;
}

// Defensive deep-walk of the gateway API response. Known shape today:
// { style: { mrp, price: { discounted, mrp } } } — but any nested object
// carrying price.discounted (with an mrp nearby) is accepted.
export function parseGatewayProduct(data: unknown): ParsedPrice | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [data];
  let visited = 0;
  while (stack.length && visited < 5000) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    visited++;
    const o = node as Record<string, unknown>;
    const priceObj = o.price;
    if (priceObj && typeof priceObj === "object" && !Array.isArray(priceObj)) {
      const p = priceObj as Record<string, unknown>;
      const discounted = numeric(p.discounted ?? p.discountedPrice);
      if (discounted != null) {
        const mrp = numeric(p.mrp ?? o.mrp);
        return { price: discounted, mrp, strategy: "gateway" };
      }
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}
