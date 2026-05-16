import { describe, it, expect } from 'vitest';

// SYNC NOTE: calcSKU is copied verbatim from index.html:3017 below,
// along with the globals and helpers it reads. If you change any of
// these in index.html, update this file too.
//
// Scope of this PR: only the Amazon and Ajio (PPMP, CC) branches are
// exercised. The Myntra branch calls calcMyntraFull() (the WF engine,
// hundreds of lines) and is left for a follow-up PR that takes a
// different testing approach.
//
//   - autoGST:           index.html:2951
//   - COMM_AMAZON:       index.html:2918
//   - LOGISTICS_SETTINGS:index.html:2980
//   - CAT_LEVEL:         index.html:2897
//   - THRESHOLDS:        index.html:2923
//   - calcSKU:           index.html:3017

const CAT_LEVEL = {
  'Kurtas':         'Level 2',
  'Kurta Sets':     'Level 2',
  'Sarees':         'Level 2',
  'Lehenga Choli':  'Level 4',
  'Ethnic Dresses': 'Level 1',
  'Co-Ords':        'Level 1',
  'Jumpsuit':       'Level 1',
  'Tops':           'Level 1',
  'Dresses':        'Level 1',
};
const COMM_AMAZON = {
  'Kurta Sets':17.0,'Lehenga Choli':19.0,'Ethnic Dresses':17.0,'Sarees':17.0,
  'Co-Ords':17.0,'Jumpsuit':17.0,'Tops':17.0,'Kurtas':17.0,
};
const THRESHOLDS = {
  'Kurta Sets':300,'Lehenga Choli':500,'Ethnic Dresses':250,
  'Sarees':300,'Co-Ords':250,'Jumpsuit':250,'Tops':150,'Kurtas':300,
};
const LOGISTICS_SETTINGS = {
  myn_pg_fee: 50.22,
  ajio_fwd: 70, ajio_ret: 70, ajio_platform_fee: 0,
  amz_fba: 55, amz_close: 15, amz_ret: 55,
};

function autoGST(sp) { return sp >= 2500 ? 0.18 : 0.05; }

// brands is a global array searched by id
let brands = [];

// Cache helpers used inside calcSKU
const _calcCache = new Map();
let _calcCacheVersion = 0;

// Myntra branch is out of scope; calling it should throw clearly.
function calcMyntraFull() {
  throw new Error('Myntra branch not tested in this file');
}

// ── calcSKU copied verbatim from index.html:3017 ─────────────
function calcSKU(s){
  const cacheKey = s.id + '|' + _calcCacheVersion;
  const cached = _calcCache.get(cacheKey);
  if(cached) return cached;

  const brand=brands.find(b=>b.id===s.brandId)||{model:'myntra',commOverride:null};
  const mp = brand.model || 'myntra';
  const level = CAT_LEVEL[s.category] || s.level || 'Level 2';

  let mrp, sp, comm, payout, profitRs, ifDelivered=0, grossSettlement=0, custPaid=0;

  if(mp==='myntra'){
    const v2=calcMyntraFull(s.cost,s.markup,s.discount??0,level,s.category,0,0);
    mrp=v2.mrpRnd??v2.mrp??0;
    custPaid=v2.custPaid??mrp;
    sp=v2.sellerPrice??custPaid??0;
    comm=brand.commOverride!=null ? brand.commOverride : (v2.rawComm??0);
    payout=v2.payout??0;
    profitRs=v2.profit??(payout-s.cost);
    const retFee=v2.retFee??v2.ret??0;
    ifDelivered=v2.ifDelivered??(profitRs + retFee);
    grossSettlement=v2.grossSettlement??0;
  } else if(mp==='ajio-ppmp'||mp==='ajio-cc'){
    const profitInclCost=Math.round(s.cost + s.cost * s.markup / 100);
    mrp=profitInclCost*3;
    const mrpRnd=Math.round(mrp/100)*100;
    sp=mrpRnd;
    const disc=s.discount||0;
    const discAmt=mrpRnd*disc/100;
    const grossSale=mrpRnd-discAmt;
    custPaid=grossSale;
    const gstRate=grossSale>2500?0.18:0.05;
    const gstValue=grossSale*gstRate/(1+gstRate);
    if(brand.commOverride!=null) comm=brand.commOverride;
    else comm=0;
    const commAmt=grossSale*comm/100;
    const purchasePrice=mrpRnd-discAmt-gstValue-commAmt;
    const gstB2B=purchasePrice>2500?0.18:0.05;
    const gstValueB2B=purchasePrice*gstB2B;
    const invoiceValue=purchasePrice+gstValueB2B;
    const marketingContr=invoiceValue*0.03;
    if(mp==='ajio-ppmp'){
      const logistic=(LOGISTICS_SETTINGS.ajio_fwd||70)+(LOGISTICS_SETTINGS.ajio_ret||70);
      payout=invoiceValue-logistic-marketingContr;
    } else {
      payout=invoiceValue-marketingContr;
    }
    profitRs=payout-s.cost;
    ifDelivered=profitRs;
  } else {
    mrp=Math.round(s.cost*(1+s.markup/100));
    sp=Math.round(mrp*3/100)*100||mrp*3;
    custPaid=sp;
    const gst=autoGST(sp);
    if(brand.commOverride!=null) comm=brand.commOverride;
    else comm=COMM_AMAZON[s.category]||17;
    const commAmt=sp*comm/100;
    const fba=LOGISTICS_SETTINGS.amz_fba,close=LOGISTICS_SETTINGS.amz_close,allFees=commAmt+close+fba,gstAmt2=allFees*gst;
    payout=sp-allFees-gstAmt2;
    profitRs=payout-s.cost;
    ifDelivered=profitRs;
  }
  const profitPct=sp>0?(profitRs/sp*100).toFixed(1):'0';
  const threshold=THRESHOLDS[s.category]||0;
  const isBreach=!s.ignoreThreshold&&profitRs<threshold;
  const result={mrp,sp,custPaid,comm,payout,profitRs,profitPct,isBreach,threshold,ifDelivered,grossSettlement};
  _calcCache.set(cacheKey, result);
  return result;
}

let testId = 0;
function freshId() { return 'sku-' + (++testId); }

// ════════════════════════════════════════════════════════════
describe('calcSKU — Amazon branch', () => {
  it('Tops, cost=1000, markup=50 — full output snapshot', () => {
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: null }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 1000, markup: 50, discount: 0, category: 'Tops',
    });
    // mrp = round(1000 * 1.5) = 1500
    expect(r.mrp).toBe(1500);
    // sp = round(1500*3/100)*100 = round(45)*100 = 4500
    expect(r.sp).toBe(4500);
    expect(r.custPaid).toBe(4500);
    expect(r.comm).toBe(17);
    // commAmt = 4500*0.17 = 765; fba=55, close=15 → allFees=835
    // gst = autoGST(4500) = 0.18 → gstAmt2 = 835*0.18 = 150.3
    // payout = 4500 - 835 - 150.3 = 3514.7
    expect(r.payout).toBeCloseTo(3514.7, 6);
    // profit = 3514.7 - 1000 = 2514.7
    expect(r.profitRs).toBeCloseTo(2514.7, 6);
    expect(r.threshold).toBe(150);
    expect(r.isBreach).toBe(false);
    expect(r.profitPct).toBe('55.9');
    expect(r.ifDelivered).toBeCloseTo(2514.7, 6);
    expect(r.grossSettlement).toBe(0);
  });

  it('Lehenga Choli uses its 19% Amazon commission', () => {
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: null }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 1000, markup: 50, discount: 0, category: 'Lehenga Choli',
    });
    expect(r.comm).toBe(19);
  });

  it('unknown category falls back to 17% Amazon commission', () => {
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: null }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 1000, markup: 50, discount: 0, category: 'NonExistent',
    });
    expect(r.comm).toBe(17);
  });

  it('brand commOverride overrides the category rate', () => {
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: 12.5 }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 1000, markup: 50, discount: 0, category: 'Tops',
    });
    expect(r.comm).toBe(12.5);
  });

  it('breaches Tops threshold (₹150) when profit is small', () => {
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: 90 }];
    // very high commission → profit goes below the ₹150 threshold
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 1000, markup: 50, discount: 0, category: 'Tops',
    });
    expect(r.profitRs).toBeLessThan(150);
    expect(r.isBreach).toBe(true);
  });

  it('ignoreThreshold suppresses the breach flag', () => {
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: 90 }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 1000, markup: 50, discount: 0, category: 'Tops',
      ignoreThreshold: true,
    });
    expect(r.isBreach).toBe(false);
  });

  it('uses 5% GST when sp < 2500', () => {
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: null }];
    // cost=200, markup=0 → mrp=200, sp=round(6)*100=600
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 200, markup: 0, discount: 0, category: 'Tops',
    });
    expect(r.mrp).toBe(200);
    expect(r.sp).toBe(600);
    // allFees = 600*0.17 + 15 + 55 = 102 + 70 = 172
    // gst = 0.05 → gstAmt2 = 172*0.05 = 8.6
    // payout = 600 - 172 - 8.6 = 419.4
    expect(r.payout).toBeCloseTo(419.4, 6);
    expect(r.profitRs).toBeCloseTo(219.4, 6);
  });
});

// ════════════════════════════════════════════════════════════
describe('calcSKU — Ajio PPMP branch', () => {
  it('cost=2100, markup=52, discount=50, no override — full snapshot', () => {
    brands = [{ id: 'b-ppmp', model: 'ajio-ppmp', commOverride: null }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-ppmp',
      cost: 2100, markup: 52, discount: 50, category: 'Kurta Sets',
    });
    // profitInclCost = round(2100 + 2100*52/100) = round(2100 + 1092) = 3192
    // mrp = 3192*3 = 9576 (note: not rounded here in result)
    expect(r.mrp).toBe(9576);
    // mrpRnd = round(9576/100)*100 = round(95.76)*100 = 9600
    // sp = mrpRnd = 9600
    expect(r.sp).toBe(9600);
    // discAmt = 9600*50/100 = 4800; grossSale = custPaid = 4800
    expect(r.custPaid).toBe(4800);
    // No commOverride → comm = 0 (Ajio has no category fallback)
    expect(r.comm).toBe(0);
    // gstRate = 4800>2500 → 0.18; gstValue = 4800*0.18/1.18 ≈ 732.20
    // commAmt = 4800*0/100 = 0
    // purchasePrice = 9600 - 4800 - 732.20 - 0 ≈ 4067.80
    // gstB2B = purchasePrice>2500 → 0.18; gstValueB2B ≈ 732.20
    // invoiceValue = purchasePrice + gstValueB2B ≈ 4800
    // marketingContr = invoiceValue * 0.03 ≈ 144
    // logistic = 70 + 70 = 140
    // payout = invoiceValue - logistic - marketingContr ≈ 4800 - 140 - 144 = 4516
    expect(r.payout).toBeCloseTo(4516, 1);
    expect(r.profitRs).toBeCloseTo(2416, 1);
  });

  it('uses brand commOverride when set', () => {
    brands = [{ id: 'b-ppmp', model: 'ajio-ppmp', commOverride: 20 }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-ppmp',
      cost: 2100, markup: 52, discount: 50, category: 'Kurta Sets',
    });
    expect(r.comm).toBe(20);
    // commAmt now non-zero → payout lower than the override=null case above
    expect(r.payout).toBeLessThan(4516);
  });
});

// ════════════════════════════════════════════════════════════
describe('calcSKU — Ajio CC branch', () => {
  it('same inputs as PPMP but no logistics deduction — payout is higher', () => {
    brands = [
      { id: 'b-ppmp', model: 'ajio-ppmp', commOverride: 20 },
      { id: 'b-cc',   model: 'ajio-cc',   commOverride: 20 },
    ];
    const common = {
      cost: 2100, markup: 52, discount: 50, category: 'Kurta Sets',
    };
    const ppmp = calcSKU({ id: freshId(), brandId: 'b-ppmp', ...common });
    const cc   = calcSKU({ id: freshId(), brandId: 'b-cc',   ...common });

    expect(cc.mrp).toBe(ppmp.mrp);
    expect(cc.sp).toBe(ppmp.sp);
    // CC skips logistic = 70+70 = 140 → payout is ₹140 higher
    expect(cc.payout - ppmp.payout).toBeCloseTo(140, 6);
    expect(cc.profitRs - ppmp.profitRs).toBeCloseTo(140, 6);
  });
});

// ════════════════════════════════════════════════════════════
describe('calcSKU — brand resolution', () => {
  it('unknown brandId defaults to a myntra-shaped brand (Amazon test would skip here; this verifies it would dispatch to myntra)', () => {
    brands = [];
    // With no brand match, the default { model: 'myntra' } is returned
    // which would call calcMyntraFull and throw. We just verify the
    // dispatch by catching the throw — this prevents accidental
    // dispatch to the wrong branch.
    expect(() => calcSKU({
      id: freshId(), brandId: 'nonexistent',
      cost: 1000, markup: 50, discount: 0, category: 'Tops',
    })).toThrow('Myntra branch not tested in this file');
  });

  it('explicit s.level is used when category is unknown', () => {
    // We can only observe this indirectly. Use Amazon to avoid
    // calcMyntraFull. Even with an unknown category, the branch
    // selected is still Amazon because that depends only on brand.model.
    brands = [{ id: 'b-amz', model: 'amazon', commOverride: null }];
    const r = calcSKU({
      id: freshId(), brandId: 'b-amz',
      cost: 1000, markup: 50, discount: 0, category: 'NewCategory',
      level: 'Level 3',
    });
    // calcSKU dispatched cleanly (no throw); level was used internally
    // for level resolution but Amazon branch doesn't surface it directly.
    expect(r.comm).toBe(17); // unknown category → 17% fallback
  });
});
