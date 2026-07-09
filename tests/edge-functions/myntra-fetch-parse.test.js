import { describe, it, expect } from 'vitest';
import {
  parseMyntraPrice,
  deepFindPrice,
  fingerprintHtml,
  fingerprintSummary,
} from '../../tools/myntra-fetch/parse.mjs';

// Unit tests for the laptop fetcher's price parser (tools/myntra-fetch/parse.mjs)
// — the only Myntra parser now that the server-side Edge Function is removed.
// Fixtures use markup captured from live Myntra product pages.

describe('parseMyntraPrice — JSON-LD (the real live markup)', () => {
  it('reads offers.price from the Product JSON-LD block (₹2449 case)', () => {
    const page = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Fusionic Kurta","offers":{"@type":"Offer","priceCurrency":"INR","price":"2449"}}</script><span>"mrp":4999</span>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2449, mrp: 4999, strategy: 'json-ld' });
  });
  it('reads offers.lowPrice / priceSpecification.price too', () => {
    expect(parseMyntraPrice(`<script type="application/ld+json">{"@type":"Product","offers":{"lowPrice":"1999"}}</script>`))
      .toMatchObject({ price: 1999, strategy: 'json-ld' });
    expect(parseMyntraPrice(`<script type="application/ld+json">{"@type":"Product","offers":{"priceSpecification":{"price":2499}}}</script>`))
      .toMatchObject({ price: 2499, strategy: 'json-ld' });
  });
  it('skips malformed JSON-LD and falls through to embedded state', () => {
    const page = `<script type="application/ld+json">{broken</script><script>window.__myx = {"pdpData":{"price":{"discounted":2358,"mrp":4499}}}</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2358, mrp: 4499, strategy: 'state' });
  });
});

describe('parseMyntraPrice — embedded state (__myx / __INITIAL_STATE__)', () => {
  it('deep-walks window.__myx pdpData for discounted price', () => {
    const page = `<script>window.__myx = {"pdpData":{"id":40451814,"price":{"mrp":9000,"discounted":2951}},"x":{"n":"{\\"q\\":1}"}}</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 2951, mrp: 9000, strategy: 'state' });
  });
  it('survives braces inside string values', () => {
    const page = `<script>window.__myx = {"pdpData":{"desc":"has { and } inside","price":{"discounted":777,"mrp":2000}}}</script>`;
    expect(parseMyntraPrice(page)).toMatchObject({ price: 777, mrp: 2000, strategy: 'state' });
  });
  it('reads a sellingPrice-shaped alternate-marker state', () => {
    expect(parseMyntraPrice(`<script>window.__INITIAL_STATE__ = {"product":{"mrp":6000,"sellingPrice":2799}}</script>`))
      .toMatchObject({ price: 2799, mrp: 6000, strategy: 'state' });
  });
  it('handles amounts wrapped as {value}', () => {
    expect(parseMyntraPrice(`<script>window.__myx={"pdpData":{"price":{"discounted":{"value":1234},"mrp":{"value":5000}}}}</script>`))
      .toMatchObject({ price: 1234, mrp: 5000, strategy: 'state' });
  });
});

describe('parseMyntraPrice — regex, meta, DOM fallbacks', () => {
  it('falls back to a raw "discounted" key', () => {
    expect(parseMyntraPrice(`<script>var s={"style":{"mrp":9000,"prices":{"discounted":2951}}}</script>`))
      .toMatchObject({ price: 2951, mrp: 9000, strategy: 'regex' });
  });
  it('reads og:price:amount meta (either attribute order)', () => {
    expect(parseMyntraPrice(`<meta property="og:price:amount" content="3499"/>`)).toMatchObject({ price: 3499, strategy: 'meta' });
    expect(parseMyntraPrice(`<meta content="4599" property="product:price:amount"/>`)).toMatchObject({ price: 4599, strategy: 'meta' });
  });
  it('parses the rendered pdp-price DOM node', () => {
    expect(parseMyntraPrice(`<span class="pdp-price"><strong>₹12,499</strong></span>`)).toMatchObject({ price: 12499, strategy: 'dom' });
  });
  it('returns null for a block page / empty / garbage values', () => {
    expect(parseMyntraPrice('<html><title>Site Maintenance</title></html>')).toBeNull();
    expect(parseMyntraPrice('')).toBeNull();
    expect(parseMyntraPrice(null)).toBeNull();
    expect(parseMyntraPrice('<script>var x={"discounted":0}</script>')).toBeNull();
    expect(parseMyntraPrice('<script>var x={"discounted":99999999999}</script>')).toBeNull();
  });
});

describe('deepFindPrice', () => {
  it('finds discounted/sellingPrice/finalPrice at any depth', () => {
    expect(deepFindPrice({ x: { discounted: 100 } })).toMatchObject({ price: 100 });
    expect(deepFindPrice({ x: { sellingPrice: 200, mrp: 500 } })).toMatchObject({ price: 200, mrp: 500 });
    expect(deepFindPrice({ x: { price: { finalPrice: 300 } } })).toMatchObject({ price: 300 });
  });
  it('returns null when there is no price and survives cycles', () => {
    const cyclic = { a: {} }; cyclic.a.back = cyclic;
    expect(deepFindPrice(cyclic)).toBeNull();
    expect(deepFindPrice({ a: 1, b: { c: 'x' } })).toBeNull();
  });
});

describe('fingerprintHtml / fingerprintSummary — failure diagnostics', () => {
  it('flags a bot-challenge / blocked page', () => {
    const fp = fingerprintHtml('<html><title>Site Maintenance</title><body>unusual traffic</body></html>');
    expect(fp.looksBlocked).toBe(true);
    expect(fingerprintSummary(fp)).toMatch(/blocked|challenged/i);
  });
  it('reports present markers on a real-but-unparsed page', () => {
    const big = '<html><title>Kurta</title>' + 'x'.repeat(3000) + '<script>var a={"mrp":9000}</script><div class="pdp-price"></div></html>';
    const fp = fingerprintHtml(big);
    expect(fp.looksBlocked).toBe(false);
    expect(fp.hasPdpPrice).toBe(true);
    expect(fp.priceKeys).toContain('mrp');
    expect(fingerprintSummary(fp)).toMatch(/pdp-price/);
  });
});
