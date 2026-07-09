import { describe, it, expect } from 'vitest';
import {
  MAX_STYLE_IDS,
  validateStyleIds,
  parseMyntraPrice,
  parseGatewayProduct,
  deepFindPrice,
  fingerprintHtml,
  fingerprintSummary,
  debugSnippet,
  buildScraperUrl,
} from '../../supabase/functions/myntra-price/parse.ts';

// These exercise the pure parsing/validation logic — they do NOT call
// myntra.com or run the Deno serve handler.

describe('validateStyleIds', () => {
  it('accepts a list of numeric style ids', () => {
    const r = validateStyleIds(['40451814', '40455542']);
    expect(r.ok).toBe(true);
    expect(r.ids).toEqual(['40451814', '40455542']);
  });

  it('accepts numbers and trims strings', () => {
    const r = validateStyleIds([40451814, ' 40455542 ']);
    expect(r.ok).toBe(true);
    expect(r.ids).toEqual(['40451814', '40455542']);
  });

  it('dedupes repeated ids', () => {
    const r = validateStyleIds(['40451814', '40451814']);
    expect(r.ids).toEqual(['40451814']);
  });

  it('rejects empty, non-array, and oversize inputs', () => {
    expect(validateStyleIds([]).ok).toBe(false);
    expect(validateStyleIds('40451814').ok).toBe(false);
    expect(validateStyleIds(undefined).ok).toBe(false);
    expect(validateStyleIds(Array.from({ length: MAX_STYLE_IDS + 1 }, (_, i) => String(10000000 + i))).ok).toBe(false);
  });

  it('rejects non-numeric ids (path traversal / URL smuggling)', () => {
    expect(validateStyleIds(['../gateway/secret']).ok).toBe(false);
    expect(validateStyleIds(['40451814?x=1']).ok).toBe(false);
    expect(validateStyleIds(['abc123']).ok).toBe(false);
    expect(validateStyleIds(['123']).ok).toBe(false); // too short
  });

  it('quarantines malformed ids per-id instead of poisoning the batch', () => {
    const r = validateStyleIds(['40451814', 'TBD', '40455542']);
    expect(r.ok).toBe(true);
    expect(r.ids).toEqual(['40451814', '40455542']);
    expect(r.invalid).toEqual(['TBD']);
  });

  it('reports invalid ids when nothing valid remains', () => {
    const r = validateStyleIds(['TBD', 'MYN-123']);
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual(['TBD', 'MYN-123']);
  });
});

describe('parseMyntraPrice — JSON-LD strategy', () => {
  const ldPage = `<html><head>
    <script type="application/ld+json">{"@context":"http://schema.org","@type":"Product","name":"Fusionic Lehenga","offers":{"@type":"Offer","priceCurrency":"INR","price":"2951","availability":"InStock"}}</script>
    </head><body><span>"mrp":9000</span></body></html>`;

  it('extracts price from a Product offers block', () => {
    const r = parseMyntraPrice(ldPage);
    expect(r).toMatchObject({ price: 2951, strategy: 'json-ld' });
    expect(r.mrp).toBe(9000);
  });

  it('handles an array of JSON-LD nodes and offer arrays', () => {
    const page = `<script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"Product","offers":[{"price":1499}]}]</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 1499, strategy: 'json-ld' });
  });

  it('skips malformed JSON-LD and falls through', () => {
    const page = `<script type="application/ld+json">{broken json</script>
      <script>window.__myx = {"pdpData":{"price":{"discounted":2951,"mrp":9000}}};</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2951, mrp: 9000, strategy: 'state' });
  });

  it('reads offers.lowPrice and priceSpecification.price too', () => {
    const p1 = `<script type="application/ld+json">{"@type":"Product","offers":{"lowPrice":"1999"}}</script>`;
    expect(parseMyntraPrice(p1)).toMatchObject({ price: 1999, strategy: 'json-ld' });
    const p2 = `<script type="application/ld+json">{"@type":"Product","offers":{"priceSpecification":{"price":2499}}}</script>`;
    expect(parseMyntraPrice(p2)).toMatchObject({ price: 2499, strategy: 'json-ld' });
  });
});

describe('parseMyntraPrice — embedded state strategy', () => {
  it('extracts discounted price and mrp from window.__myx pdpData', () => {
    const page = `<script>window.__myx = {"pdpData":{"id":40451814,"name":"X","price":{"mrp":9000,"discounted":2951}},"other":{"nested":"{\\"quoted\\":1}"}};</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2951, mrp: 9000, strategy: 'state' });
  });

  it('survives braces inside string values (balanced-brace scan)', () => {
    const page = `<script>window.__myx = {"pdpData":{"desc":"has { and } inside","price":{"discounted":777,"mrp":2000}}};</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 777, mrp: 2000, strategy: 'state' });
  });

  it('reads a sellingPrice-shaped state under an alternate marker', () => {
    const page = `<script>window.__INITIAL_STATE__ = {"product":{"mrp":6000,"sellingPrice":2799}};</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2799, mrp: 6000, strategy: 'state' });
  });

  it('handles sellingPrice wrapped as {value}', () => {
    const page = `<script>window.__myx={"pdpData":{"price":{"discounted":{"value":1234},"mrp":{"value":5000}}}}</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 1234, mrp: 5000, strategy: 'state' });
  });
});

describe('parseMyntraPrice — meta tag strategy', () => {
  it('reads og:price:amount (either attribute order)', () => {
    const p1 = `<meta property="og:price:amount" content="3499"/>`;
    expect(parseMyntraPrice(p1)).toMatchObject({ price: 3499, strategy: 'meta' });
    const p2 = `<meta content="4599" property="product:price:amount"/>`;
    expect(parseMyntraPrice(p2)).toMatchObject({ price: 4599, strategy: 'meta' });
  });
});

describe('parseMyntraPrice — regex + DOM fallbacks', () => {
  it('falls back to raw "discounted" key', () => {
    const page = `<script>var state={"style":{"mrp":9000,"prices":{"discounted":2951}}};</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2951, mrp: 9000, strategy: 'regex' });
  });

  it('parses the rendered pdp-price DOM node (screenshot markup)', () => {
    const page = `<p class="pdp-discount-container"><span class="pdp-price" tabindex="0"><strong>₹2951</strong></span><span class="pdp-mrp"></span></p>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2951, strategy: 'dom' });
  });

  it('parses comma-grouped DOM prices', () => {
    const page = `<span class="pdp-price"><strong>₹12,499</strong></span>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 12499, strategy: 'dom' });
  });

  it('returns null for pages with no price (bot challenge, 404 page)', () => {
    expect(parseMyntraPrice('<html><body>Access Denied</body></html>')).toBeNull();
    expect(parseMyntraPrice('')).toBeNull();
    expect(parseMyntraPrice(null)).toBeNull();
  });

  it('rejects absurd values instead of returning garbage', () => {
    expect(parseMyntraPrice('<script>var x={"discounted":0};</script>')).toBeNull();
    expect(parseMyntraPrice('<script>var x={"discounted":99999999999};</script>')).toBeNull();
  });
});

describe('parseGatewayProduct', () => {
  it('reads the documented style.price shape', () => {
    const data = { style: { id: 40451814, mrp: 9000, price: { discounted: 2951, mrp: 9000 } } };
    expect(parseGatewayProduct(data)).toMatchObject({ price: 2951, mrp: 9000, strategy: 'gateway' });
  });

  it('finds a nested price object anywhere in the tree', () => {
    const data = { a: { b: [{ c: { price: { discounted: 1499 }, mrp: 4000 } }] } };
    expect(parseGatewayProduct(data)).toMatchObject({ price: 1499, mrp: 4000 });
  });

  it('returns null when no price exists and survives cycles', () => {
    const cyclic = { a: {} };
    cyclic.a.back = cyclic;
    expect(parseGatewayProduct(cyclic)).toBeNull();
    expect(parseGatewayProduct(null)).toBeNull();
    expect(parseGatewayProduct({ error: 'not found' })).toBeNull();
  });

  it('reads a sellingPrice-only gateway node', () => {
    expect(parseGatewayProduct({ data: { sellingPrice: 899, mrp: 1999 } }))
      .toMatchObject({ price: 899, mrp: 1999 });
  });
});

describe('deepFindPrice', () => {
  it('finds discounted, sellingPrice, or finalPrice at any depth', () => {
    expect(deepFindPrice({ x: { discounted: 100 } })).toMatchObject({ price: 100 });
    expect(deepFindPrice({ x: { sellingPrice: 200, mrp: 500 } })).toMatchObject({ price: 200, mrp: 500 });
    expect(deepFindPrice({ x: { price: { finalPrice: 300 } } })).toMatchObject({ price: 300 });
  });
  it('returns null when there is no price', () => {
    expect(deepFindPrice({ a: 1, b: { c: 'x' } })).toBeNull();
  });
});

describe('fingerprintHtml / fingerprintSummary — failure diagnostics', () => {
  it('flags a bot-challenge / blocked page', () => {
    const fp = fingerprintHtml('<html><title>Access Denied</title><body>unusual traffic</body></html>');
    expect(fp.looksBlocked).toBe(true);
    expect(fingerprintSummary(fp)).toMatch(/blocked|challenged/i);
  });
  it('flags a tiny page as blocked', () => {
    expect(fingerprintHtml('<html></html>').looksBlocked).toBe(true);
  });
  it('reports present markers on a real-but-unparsed page', () => {
    const big = '<html><title>Kurta</title>' + 'x'.repeat(3000) + '<script>var a={"mrp":9000}</script><div class="pdp-price"></div></html>';
    const fp = fingerprintHtml(big);
    expect(fp.looksBlocked).toBe(false);
    expect(fp.hasPdpPrice).toBe(true);
    expect(fp.priceKeys).toContain('mrp');
    expect(fingerprintSummary(fp)).toMatch(/pdp-price/);
    expect(fingerprintSummary(fp)).toMatch(/keys:mrp/);
  });
});

describe('buildScraperUrl', () => {
  const SCRAPERAPI = 'https://api.scraperapi.com/?api_key={key}&url={url}&country_code=in';
  it('substitutes key and URL-encodes the target', () => {
    const out = buildScraperUrl(SCRAPERAPI, 'SECRET123', 'https://www.myntra.com/40451814');
    expect(out).toBe('https://api.scraperapi.com/?api_key=SECRET123&url=https%3A%2F%2Fwww.myntra.com%2F40451814&country_code=in');
  });
  it('encodes gateway URLs with slashes', () => {
    const out = buildScraperUrl(SCRAPERAPI, 'K', 'https://www.myntra.com/gateway/v2/product/40451814');
    expect(out).toContain('url=https%3A%2F%2Fwww.myntra.com%2Fgateway%2Fv2%2Fproduct%2F40451814');
    expect(out).not.toContain('{url}');
    expect(out).not.toContain('{key}');
  });
  it('works with a ScrapingBee-style template and a missing key', () => {
    const bee = 'https://app.scrapingbee.com/api/v1/?api_key={key}&url={url}';
    const out = buildScraperUrl(bee, '', 'https://www.myntra.com/1');
    expect(out).toBe('https://app.scrapingbee.com/api/v1/?api_key=&url=https%3A%2F%2Fwww.myntra.com%2F1');
  });
  it('returns null for a template without the {url} placeholder', () => {
    expect(buildScraperUrl('https://x.com/?k={key}', 'K', 'https://www.myntra.com/1')).toBeNull();
    expect(buildScraperUrl('', 'K', 'https://www.myntra.com/1')).toBeNull();
  });
});

describe('debugSnippet', () => {
  it('returns the title and a window around the first price marker', () => {
    const page = '<html><title>Fusionic Lehenga</title>' + 'y'.repeat(500) + '<script>var s={"discounted":2951}</script></html>';
    const snip = debugSnippet(page);
    expect(snip).toMatch(/Fusionic Lehenga/);
    expect(snip).toMatch(/discounted.*2951/);
  });
  it('caps its length', () => {
    expect(debugSnippet('z'.repeat(50000)).length).toBeLessThan(2200);
  });
});
