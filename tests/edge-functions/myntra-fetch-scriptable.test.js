import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseMyntraPrice as parseMjs,
  isOutOfStock as oosMjs,
} from '../../tools/myntra-fetch/parse.mjs';

// The iPhone (Scriptable) fetcher is a single self-contained script whose
// parser is a copy of parse.mjs. These tests (1) load it in Node via an
// async-function harness with a shimmed Scriptable `Request`, (2) assert
// parser behaviour matches parse.mjs, (3) run an offline end-to-end fetch
// against mocked Myntra pages + Supabase REST, (4) drift-guard the copied
// parser strings.

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(HERE, '../../tools/myntra-fetch/scriptable-myntra-fetch.js');
const SRC = readFileSync(SRC_PATH, 'utf8');
const PARSE_MJS = readFileSync(join(HERE, '../../tools/myntra-fetch/parse.mjs'), 'utf8');

// ── Scriptable Request shim + mock backends ────────────────────────────────
const store = {
  brands: [{ id: 'b1', model: 'myntra' }, { id: 'b2', model: 'ajio-ppmp' }],
  skus: [
    { style_id: '40451814', brand_id: 'b1', archived: false }, // ok
    { style_id: '40777777', brand_id: 'b1', archived: false }, // out of stock
    { style_id: '99999999', brand_id: 'b1', archived: false }, // blocked
    { style_id: '40451814', brand_id: 'b1', archived: false }, // dup → deduped
    { style_id: 'TBD',      brand_id: 'b1', archived: false }, // non-numeric → skip
    { style_id: '11112222', brand_id: 'b1', archived: true },  // archived → skip
    { style_id: '40636475', brand_id: 'b2', archived: false }, // ajio → skip
  ],
  app_data: { pd_live_prices: { '30000000': { price: 111, mrp: 200, ts: 1 } } },
  sync: [],
  statusWrites: [],
};

const REAL = (price) => `<html><head><script type="application/ld+json">{"@type":"Product","offers":{"price":"${price}"}}</script><span>"mrp":4999</span></head><body class="pdp-price">x</body></html>`;
const OOS_PAGE = `<html><script>window.__myx={"pdpData":{"systemAttributeEntry":{"attributeCode":"SA_XT_OOS"},"price":{"mrp":9000,"discounted":9000}}}</script></html>`;
const BLOCK = '<html><title>Site Maintenance</title></html>';

class RequestShim {
  constructor(url) { this.url = url; this.method = 'GET'; this.headers = {}; this.body = null; this.response = { statusCode: 200 }; }
  async loadString() {
    const u = this.url;
    // Myntra PDPs
    const m = u.match(/myntra\.com\/(\d+)$/);
    if (m) {
      const id = m[1];
      if (id === '40451814') return REAL(2449);
      if (id === '40777777') return OOS_PAGE;
      return BLOCK;
    }
    // Supabase REST
    if (u.includes('/rest/v1/pd_brands')) return JSON.stringify(store.brands);
    if (u.includes('/rest/v1/pd_skus_v2')) {
      const off = Number((u.match(/offset=(\d+)/) || [])[1] || 0);
      return JSON.stringify(off === 0 ? store.skus : []);
    }
    if (u.includes('/rest/v1/app_data?key=eq.')) {
      const key = u.match(/key=eq\.([^&]+)/)[1];
      const v = store.app_data[key];
      return JSON.stringify(v !== undefined ? [{ value: v }] : []);
    }
    if (this.method === 'POST' && u.includes('/rest/v1/app_data')) {
      for (const row of JSON.parse(this.body)) {
        store.app_data[row.key] = row.value;
        if (row.key === 'pd_live_status') store.statusWrites.push(row.value);
      }
      return '';
    }
    if (this.method === 'POST' && u.includes('/rest/v1/pd_sync')) {
      for (const row of JSON.parse(this.body)) store.sync.push(row.key);
      return '';
    }
    this.response.statusCode = 404;
    return 'not found';
  }
}

let S; // the script's exported internals
beforeAll(async () => {
  const AsyncFunction = (async function () {}).constructor;
  // `config` is deliberately NOT defined → the script does not auto-run.
  const factory = new AsyncFunction('Request', 'setTimeout', SRC + '\nreturn __exports;');
  S = await factory(RequestShim, (fn) => fn()); // zero-delay sleep for tests
});

describe('scriptable fetcher — parser matches parse.mjs', () => {
  const FIXTURES = [
    `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","priceCurrency":"INR","price":"2449"}}</script><span>"mrp":4999</span>`,
    `<script>window.__myx = {"pdpData":{"price":{"discounted":2358,"mrp":4499}}}</script>`,
    `<meta property="og:price:amount" content="3499"/>`,
    `<span class="pdp-price"><strong>₹12,499</strong></span>`,
    BLOCK,
    '',
  ];
  it('parseMyntraPrice agrees on every fixture', () => {
    for (const f of FIXTURES) expect(S.parseMyntraPrice(f)).toEqual(parseMjs(f));
  });
  it('isOutOfStock agrees', () => {
    expect(S.isOutOfStock(OOS_PAGE)).toBe(oosMjs(OOS_PAGE));
    expect(S.isOutOfStock(REAL(2449))).toBe(oosMjs(REAL(2449)));
  });
});

describe('scriptable fetcher — offline end-to-end', () => {
  it('runs main(): dedupes/filters, parses, records OOS + errors, merges, writes status + sync pings', async () => {
    const result = await S.main();
    expect(result).toMatchObject({ total: 3, ok: 2, fail: 1, oos: 1 });
    const lp = store.app_data['pd_live_prices'];
    expect(lp['30000000']).toMatchObject({ price: 111 });                 // merge preserved
    expect(lp['40451814']).toMatchObject({ price: 2449, mrp: 4999 });     // parsed
    expect(lp['40777777']).toMatchObject({ oos: true, mrp: 9000 });       // out of stock
    expect(lp['99999999'].price).toBeNull();                              // blocked → error
    expect(lp['99999999'].err).toMatch(/blocked|Maintenance/i);
    expect(lp['TBD']).toBeUndefined();                                    // filtered out
    expect(lp['11112222']).toBeUndefined();
    expect(lp['40636475']).toBeUndefined();
    const final = store.statusWrites[store.statusWrites.length - 1];
    expect(final).toMatchObject({ running: false, total: 3, ok: 2, fail: 1 });
    expect(final.source).toMatch(/iPhone/);
    expect(typeof final.ts).toBe('number');
    expect(store.sync).toContain('pd_live_prices');
    expect(store.sync).toContain('pd_live_status');
  });
});

describe('scriptable fetcher — parser drift guard vs parse.mjs', () => {
  const SHARED = [
    'const PRICE_KEYS = ["discounted", "discountedPrice", "sellingPrice", "finalPrice", "salePrice"];',
    'const rawKeys = ["discounted", "sellingPrice", "finalPrice", "salePrice"];',
    '"window.__myx"',
    '"__INITIAL_STATE__"',
    'og:price:amount|product:price:amount',
    'pdp-price[^>]*>',
    '"attributeCode"\\s*:\\s*"SA_XT_OOS"',
    'page looks blocked/challenged (',
  ];
  it.each(SHARED)('shared parser string present in both files: %s', (needle) => {
    expect(SRC.includes(needle), 'missing from scriptable-myntra-fetch.js').toBe(true);
    expect(PARSE_MJS.includes(needle), 'missing from parse.mjs').toBe(true);
  });
});
