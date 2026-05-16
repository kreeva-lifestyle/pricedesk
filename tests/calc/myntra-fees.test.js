import { describe, it, expect } from 'vitest';

// SYNC NOTE: Functions and default fixtures below are copied verbatim
// from index.html. Update both places if any change.
//   - GT_DATA:         index.html:2959
//   - REVERSE_FEES:    index.html:2965
//   - COLL_FEE_DATA:   index.html:2969
//   - getMynFwd:       index.html:2986
//   - getMynRet:       index.html:2997
//   - getMynColl:      index.html:2998
//
// GT_DATA, REVERSE_FEES, and COLL_FEE_DATA are user-editable from
// the Logistics page at runtime — these fixtures use the defaults
// only to keep tests deterministic.

const GT_DATA = {
  'Level 1': [0,   1,  59,  59,  94, 171, 207],
  'Level 2': [0,   1,  83,  83, 118, 195, 230],
  'Level 3': [0,   1, 100, 106, 148, 230, 266],
  'Level 4': [0,   1, 100, 153, 189, 277, 313],
};

const REVERSE_FEES = {
  'Level 1': 167, 'Level 2': 218, 'Level 3': 259, 'Level 4': 331,
};

const COLL_FEE_DATA = {
  'Kurta Sets':     [0, 5, 19, 27, 27, 45, 61],
  'Kurtas':         [15, 17, 27, 27, 27, 45, 61],
  'Dresses':        [14, 16, 16, 27, 27, 45, 61],
  'Ethnic Dresses': [14, 16, 16, 27, 27, 45, 61],
  'Jumpsuit':       [15, 17, 27, 27, 27, 45, 61],
  'Lehenga Choli':  [0, 0, 0, 0, 0, 45, 61],
  'Sarees':         [0, 3, 26, 27, 27, 45, 61],
  'Tops':           [15, 17, 27, 27, 27, 45, 61],
  'Co-Ords':        [27, 27, 27, 27, 27, 45, 61],
};

function getMynFwd(level, sp) {
  const slabs = GT_DATA[level] || GT_DATA['Level 2'];
  const price = sp || 0;
  if (price <= 1)    return slabs[0];
  if (price <= 99)   return slabs[1];
  if (price <= 300)  return slabs[2];
  if (price <= 500)  return slabs[3];
  if (price <= 1000) return slabs[4];
  if (price <= 2000) return slabs[5];
  return slabs[6];
}

function getMynRet(level) { return REVERSE_FEES[level] || 218; }

function getMynColl(cat, sellerPrice) {
  const slabs = COLL_FEE_DATA[cat] || [15, 17, 27, 27, 27, 45, 61];
  const p = sellerPrice || 0;
  if (p <= 300)  return slabs[0];
  if (p <= 500)  return slabs[1];
  if (p <= 700)  return slabs[2];
  if (p <= 800)  return slabs[3];
  if (p <= 1000) return slabs[4];
  if (p <= 2000) return slabs[5];
  return slabs[6];
}

// ────────────────────────────────────────────────────────────────────
describe('getMynFwd — forward shipping by level and seller price', () => {
  describe('Level 2 boundary walk (rates [0, 1, 83, 83, 118, 195, 230])', () => {
    it('sp = 0     → ₹0   (price ≤ 1 band)',     () => expect(getMynFwd('Level 2', 0)).toBe(0));
    it('sp = 1     → ₹0   (price ≤ 1 band)',     () => expect(getMynFwd('Level 2', 1)).toBe(0));
    it('sp = 2     → ₹1   (price ≤ 99 band)',    () => expect(getMynFwd('Level 2', 2)).toBe(1));
    it('sp = 99    → ₹1   (price ≤ 99 band)',    () => expect(getMynFwd('Level 2', 99)).toBe(1));
    it('sp = 100   → ₹83  (price ≤ 300 band)',   () => expect(getMynFwd('Level 2', 100)).toBe(83));
    it('sp = 300   → ₹83  (price ≤ 300 band)',   () => expect(getMynFwd('Level 2', 300)).toBe(83));
    it('sp = 301   → ₹83  (price ≤ 500 band)',   () => expect(getMynFwd('Level 2', 301)).toBe(83));
    it('sp = 500   → ₹83  (price ≤ 500 band)',   () => expect(getMynFwd('Level 2', 500)).toBe(83));
    it('sp = 501   → ₹118 (price ≤ 1000 band)',  () => expect(getMynFwd('Level 2', 501)).toBe(118));
    it('sp = 1000  → ₹118 (price ≤ 1000 band)',  () => expect(getMynFwd('Level 2', 1000)).toBe(118));
    it('sp = 1001  → ₹195 (price ≤ 2000 band)',  () => expect(getMynFwd('Level 2', 1001)).toBe(195));
    it('sp = 2000  → ₹195 (price ≤ 2000 band)',  () => expect(getMynFwd('Level 2', 2000)).toBe(195));
    it('sp = 2001  → ₹230 (top band)',           () => expect(getMynFwd('Level 2', 2001)).toBe(230));
    it('sp = 99999 → ₹230 (top band)',           () => expect(getMynFwd('Level 2', 99999)).toBe(230));
  });

  describe('different levels for a fixed price', () => {
    it('sp = 1500, Level 1 → ₹171', () => expect(getMynFwd('Level 1', 1500)).toBe(171));
    it('sp = 1500, Level 2 → ₹195', () => expect(getMynFwd('Level 2', 1500)).toBe(195));
    it('sp = 1500, Level 3 → ₹230', () => expect(getMynFwd('Level 3', 1500)).toBe(230));
    it('sp = 1500, Level 4 → ₹277', () => expect(getMynFwd('Level 4', 1500)).toBe(277));
  });

  describe('fallbacks', () => {
    it('unknown level falls back to Level 2 rates', () => {
      expect(getMynFwd('Level 999', 100)).toBe(83);
    });
    it('falsy sp (undefined) treated as 0', () => {
      expect(getMynFwd('Level 2', undefined)).toBe(0);
    });
    it('falsy sp (null) treated as 0', () => {
      expect(getMynFwd('Level 2', null)).toBe(0);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
describe('getMynRet — return shipping by level', () => {
  it('Level 1 → ₹167', () => expect(getMynRet('Level 1')).toBe(167));
  it('Level 2 → ₹218', () => expect(getMynRet('Level 2')).toBe(218));
  it('Level 3 → ₹259', () => expect(getMynRet('Level 3')).toBe(259));
  it('Level 4 → ₹331', () => expect(getMynRet('Level 4')).toBe(331));
  it('unknown level → ₹218 fallback', () => expect(getMynRet('Level X')).toBe(218));
  it('undefined level → ₹218 fallback', () => expect(getMynRet(undefined)).toBe(218));
});

// ────────────────────────────────────────────────────────────────────
describe('getMynColl — collection (fixed) fee by category and seller price', () => {
  describe('Kurta Sets boundary walk (rates [0, 5, 19, 27, 27, 45, 61])', () => {
    it('sp = 0     → ₹0  (≤ 300 band)',  () => expect(getMynColl('Kurta Sets', 0)).toBe(0));
    it('sp = 300   → ₹0  (≤ 300 band)',  () => expect(getMynColl('Kurta Sets', 300)).toBe(0));
    it('sp = 301   → ₹5  (≤ 500 band)',  () => expect(getMynColl('Kurta Sets', 301)).toBe(5));
    it('sp = 500   → ₹5  (≤ 500 band)',  () => expect(getMynColl('Kurta Sets', 500)).toBe(5));
    it('sp = 501   → ₹19 (≤ 700 band)',  () => expect(getMynColl('Kurta Sets', 501)).toBe(19));
    it('sp = 700   → ₹19 (≤ 700 band)',  () => expect(getMynColl('Kurta Sets', 700)).toBe(19));
    it('sp = 701   → ₹27 (≤ 800 band)',  () => expect(getMynColl('Kurta Sets', 701)).toBe(27));
    it('sp = 800   → ₹27 (≤ 800 band)',  () => expect(getMynColl('Kurta Sets', 800)).toBe(27));
    it('sp = 801   → ₹27 (≤ 1000 band)', () => expect(getMynColl('Kurta Sets', 801)).toBe(27));
    it('sp = 1000  → ₹27 (≤ 1000 band)', () => expect(getMynColl('Kurta Sets', 1000)).toBe(27));
    it('sp = 1001  → ₹45 (≤ 2000 band)', () => expect(getMynColl('Kurta Sets', 1001)).toBe(45));
    it('sp = 2000  → ₹45 (≤ 2000 band)', () => expect(getMynColl('Kurta Sets', 2000)).toBe(45));
    it('sp = 2001  → ₹61 (top band)',    () => expect(getMynColl('Kurta Sets', 2001)).toBe(61));
    it('sp = 99999 → ₹61 (top band)',    () => expect(getMynColl('Kurta Sets', 99999)).toBe(61));
  });

  describe('different categories for a fixed price', () => {
    it('sp = 600, Kurta Sets    → ₹19', () => expect(getMynColl('Kurta Sets', 600)).toBe(19));
    it('sp = 600, Kurtas        → ₹27', () => expect(getMynColl('Kurtas', 600)).toBe(27));
    it('sp = 600, Dresses       → ₹16', () => expect(getMynColl('Dresses', 600)).toBe(16));
    it('sp = 600, Lehenga Choli → ₹0',  () => expect(getMynColl('Lehenga Choli', 600)).toBe(0));
    it('sp = 600, Co-Ords       → ₹27', () => expect(getMynColl('Co-Ords', 600)).toBe(27));
  });

  describe('fallbacks', () => {
    it('unknown category uses default slabs [15,17,27,27,27,45,61]', () => {
      expect(getMynColl('Unknown', 0)).toBe(15);
      expect(getMynColl('Unknown', 400)).toBe(17);
      expect(getMynColl('Unknown', 1500)).toBe(45);
      expect(getMynColl('Unknown', 5000)).toBe(61);
    });
    it('falsy sp treated as 0 (lowest band)', () => {
      expect(getMynColl('Kurta Sets', undefined)).toBe(0);
      expect(getMynColl('Kurta Sets', null)).toBe(0);
    });
  });
});
