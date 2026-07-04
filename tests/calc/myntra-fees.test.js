import { describe, it, expect, beforeEach } from 'vitest';

// SYNC NOTE: Functions and default fixtures below are copied verbatim
// from index.html. Update both places if any change.
//   - GT_DATA:         index.html:3085
//   - REVERSE_FEES:    index.html:3091
//   - COLL_FEE_DATA:   index.html:3130
//   - GT_SLABS:        index.html:3065
//   - REV_SLABS:       index.html:3068
//   - COLL_SLABS:      index.html:3070
//   - slabPick:        index.html:3095
//   - gtSlabValue:     index.html:3104
//   - getMynFwd:       index.html:3105
//   - getMynRet:       index.html:3111
//   - getMynColl:      index.html:3117
//
// GT_DATA, REVERSE_FEES, COLL_FEE_DATA, the slab bounds, and the
// mode settings are user-editable from the Logistics page at runtime —
// these fixtures use the defaults only to keep tests deterministic.

const GT_DATA = {
  'Level 1': [0,   1,  59,  59,  94, 171, 207],
  'Level 2': [0,   1,  83,  83, 118, 195, 230],
  'Level 3': [0,   1, 100, 106, 148, 230, 266],
  'Level 4': [0,   1, 100, 153, 189, 277, 313],
};

let REVERSE_FEES = {
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

// Editable slab bounds + mode settings (defaults mirror index.html)
let GT_SLABS = [1,99,300,500,1000,2000];
let REV_SLABS = [];
let COLL_SLABS = [300,500,700,800,1000,2000];
let GT_CAT_DATA = {};
let REV_CAT_DATA = {};
let LOGISTICS_SETTINGS = {
  myn_fwd_mode: 'level', myn_ret_mode: 'level',
  myn_fwd_fixed: 230, myn_ret_fixed: 218,
};

function slabPick(bounds, values, price){
  if(!Array.isArray(values)) return +values||0;
  if(!values.length) return 0;
  const p=price||0;
  for(let i=0;i<bounds.length;i++){
    if(p<=bounds[i]) return +values[Math.min(i,values.length-1)]||0;
  }
  return +values[Math.min(bounds.length,values.length-1)]||0;
}
function gtSlabValue(slabs, sp){ return slabPick(GT_SLABS, slabs, sp); }
function getMynFwd(level, sp, cat){
  const mode = LOGISTICS_SETTINGS.myn_fwd_mode || 'level';
  if(mode==='fixed') return +LOGISTICS_SETTINGS.myn_fwd_fixed || 0;
  if(mode==='cat' && cat && GT_CAT_DATA[cat]) return gtSlabValue(GT_CAT_DATA[cat], sp);
  return gtSlabValue(GT_DATA[level] || GT_DATA['Level 2'] || [0,1,83,83,118,195,230], sp);
}
function getMynRet(level, cat, price){
  const mode = LOGISTICS_SETTINGS.myn_ret_mode || 'level';
  if(mode==='fixed') return +LOGISTICS_SETTINGS.myn_ret_fixed || 218;
  if(mode==='cat' && cat && REV_CAT_DATA[cat]!=null) return slabPick(REV_SLABS, REV_CAT_DATA[cat], price);
  return slabPick(REV_SLABS, REVERSE_FEES[level]??218, price);
}
function getMynColl(cat, sellerPrice){
  const slabs=COLL_FEE_DATA[cat]||[15,17,27,27,27,45,61];
  const p=sellerPrice||0;
  for(let i=0;i<COLL_SLABS.length;i++){
    if(p<=COLL_SLABS[i]) return +slabs[Math.min(i,slabs.length-1)]||0;
  }
  return +slabs[Math.min(COLL_SLABS.length,slabs.length-1)]||0;
}

beforeEach(() => {
  LOGISTICS_SETTINGS = {
    myn_fwd_mode: 'level', myn_ret_mode: 'level',
    myn_fwd_fixed: 230, myn_ret_fixed: 218,
  };
  GT_SLABS = [1,99,300,500,1000,2000];
  REV_SLABS = [];
  COLL_SLABS = [300,500,700,800,1000,2000];
  GT_CAT_DATA = {};
  REV_CAT_DATA = {};
  REVERSE_FEES = { 'Level 1': 167, 'Level 2': 218, 'Level 3': 259, 'Level 4': 331 };
});

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

  describe('fixed mode', () => {
    it('returns the flat fixed rate regardless of level and price', () => {
      LOGISTICS_SETTINGS.myn_fwd_mode = 'fixed';
      LOGISTICS_SETTINGS.myn_fwd_fixed = 123;
      expect(getMynFwd('Level 1', 50)).toBe(123);
      expect(getMynFwd('Level 4', 5000)).toBe(123);
    });
  });

  describe('category-wise mode', () => {
    it('uses the category row when present, level row otherwise', () => {
      LOGISTICS_SETTINGS.myn_fwd_mode = 'cat';
      GT_CAT_DATA['Sarees'] = [0, 1, 50, 60, 90, 150, 180];
      expect(getMynFwd('Level 2', 450, 'Sarees')).toBe(60);
      expect(getMynFwd('Level 2', 2500, 'Sarees')).toBe(180);
      // Category without a row falls back to the level table
      expect(getMynFwd('Level 2', 450, 'Tops')).toBe(83);
    });
  });

  describe('editable GT slab bounds', () => {
    it('lookup follows shortened bounds with clamped value arrays', () => {
      GT_SLABS = [500, 2000];
      // 3 values: <=500, <=2000, >2000
      expect(gtSlabValue([83, 195, 230], 400)).toBe(83);
      expect(gtSlabValue([83, 195, 230], 1500)).toBe(195);
      expect(gtSlabValue([83, 195, 230], 2500)).toBe(230);
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

  describe('fixed mode', () => {
    it('returns the flat fixed rate regardless of level', () => {
      LOGISTICS_SETTINGS.myn_ret_mode = 'fixed';
      LOGISTICS_SETTINGS.myn_ret_fixed = 200;
      expect(getMynRet('Level 1')).toBe(200);
      expect(getMynRet('Level 4')).toBe(200);
    });
  });

  describe('category-wise mode', () => {
    it('uses the category fee when present, level fee otherwise', () => {
      LOGISTICS_SETTINGS.myn_ret_mode = 'cat';
      REV_CAT_DATA['Sarees'] = 175;
      expect(getMynRet('Level 1', 'Sarees')).toBe(175);
      expect(getMynRet('Level 1', 'Tops')).toBe(167);
    });
  });

  describe('editable reverse-fee price slabs', () => {
    it('flat scalar fees ignore price (no bounds configured)', () => {
      expect(getMynRet('Level 2', null, 5000)).toBe(218);
    });
    it('per-slab arrays pick by price when bounds exist', () => {
      REV_SLABS = [1000];
      REVERSE_FEES['Level 2'] = [100, 300];
      expect(getMynRet('Level 2', null, 800)).toBe(100);
      expect(getMynRet('Level 2', null, 1000)).toBe(100);
      expect(getMynRet('Level 2', null, 1500)).toBe(300);
    });
    it('scalar fee still works when bounds exist (legacy data)', () => {
      REV_SLABS = [1000];
      expect(getMynRet('Level 1', null, 5000)).toBe(167);
    });
  });
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

  describe('editable collection slab bounds', () => {
    it('lookup follows changed bounds and clamps short arrays', () => {
      COLL_SLABS = [500, 1500, 3000];
      // Kurta Sets array still has 7 entries; index clamps safely
      expect(getMynColl('Kurta Sets', 400)).toBe(0);   // slab 0
      expect(getMynColl('Kurta Sets', 1200)).toBe(5);  // slab 1
      expect(getMynColl('Kurta Sets', 2800)).toBe(19); // slab 2
      expect(getMynColl('Kurta Sets', 9000)).toBe(27); // > last bound
    });
  });
});
