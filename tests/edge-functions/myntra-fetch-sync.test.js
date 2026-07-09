import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseMyntraPrice as parseMjs,
  deepFindPrice as deepMjs,
  fingerprintHtml as fpMjs,
  fingerprintSummary as fpsMjs,
} from '../../tools/myntra-fetch/parse.mjs';
import {
  parseMyntraPrice as parseTs,
  deepFindPrice as deepTs,
  fingerprintHtml as fpTs,
} from '../../supabase/functions/myntra-price/parse.ts';

// The laptop fetcher (tools/myntra-fetch) runs on plain Node with no TS
// toolchain, so it uses a plain-JS mirror of the Edge Function's parser. This
// guards that mirror against drift: the two must behave identically and share
// the distinctive source strings that encode the parsing strategies.

const HERE = dirname(fileURLToPath(import.meta.url));
const MJS = readFileSync(join(HERE, '../../tools/myntra-fetch/parse.mjs'), 'utf8');
const TS = readFileSync(join(HERE, '../../supabase/functions/myntra-price/parse.ts'), 'utf8');

describe('myntra-fetch parse.mjs mirrors parse.ts', () => {
  // Real markup captured from a live Myntra PDP (the user's own DevTools).
  const jsonLd = `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","priceCurrency":"INR","price":"2449"}}</script><span>"mrp":4999</span>`;
  const state = `<script>window.__myx = {"pdpData":{"price":{"discounted":2358,"mrp":4499}}}</script>`;

  it('both parsers return the same result on real JSON-LD markup', () => {
    expect(parseMjs(jsonLd)).toEqual(parseTs(jsonLd));
    expect(parseMjs(jsonLd)).toMatchObject({ price: 2449, mrp: 4999, strategy: 'json-ld' });
  });

  it('both parsers agree on embedded __myx state', () => {
    expect(parseMjs(state)).toEqual(parseTs(state));
    expect(parseMjs(state)).toMatchObject({ price: 2358, strategy: 'state' });
  });

  it('deepFindPrice agrees', () => {
    const o = { a: { sellingPrice: 999, mrp: 1999 } };
    expect(deepMjs(o)).toEqual(deepTs(o));
  });

  it('fingerprint flags a block page the same way', () => {
    const blocked = '<html><title>Site Maintenance</title></html>';
    expect(fpMjs(blocked).looksBlocked).toBe(fpTs(blocked).looksBlocked);
    expect(fpsMjs(fpMjs(blocked))).toMatch(/blocked|challenged/i);
  });

  // Distinctive strings that encode each parsing strategy — must appear in BOTH
  // files so a change to one is a loud failure until the other is updated too.
  const SHARED = [
    'const PRICE_KEYS = ["discounted", "discountedPrice", "sellingPrice", "finalPrice", "salePrice"];',
    'const rawKeys = ["discounted", "sellingPrice", "finalPrice", "salePrice"];',
    '"window.__myx"',
    '"__INITIAL_STATE__"',
    'application\\/ld\\+json',
    'pdp-price[^>]*>',
    'page looks blocked/challenged (',
    'og:price:amount|product:price:amount',
  ];
  it.each(SHARED)('shared source string present in both files: %s', (needle) => {
    expect(MJS.includes(needle), 'missing from parse.mjs').toBe(true);
    expect(TS.includes(needle), 'missing from parse.ts').toBe(true);
  });
});
