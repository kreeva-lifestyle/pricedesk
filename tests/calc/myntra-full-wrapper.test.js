import { describe, it, expect } from 'vitest';

// SYNC NOTE: calcMyntraFull is copied verbatim from index.html:6776.
// It's the thin wrapper between the WF engine (already tested in
// wf-engine.test.js) and the Myntra branch of calcSKU. We test its
// result-mapping fallback logic by stubbing runWFEngine to return
// minimal results and asserting that the wrapper fills the right
// defaults via the ?? chain.
//
//   - calcMyntraFull:   index.html:6776
//
// The user-editable WF.myntra rules are not exercised here (those
// run inside runWFEngine which is tested separately with synthetic
// rule sets).

// Helpers / globals that calcMyntraFull reads
const REVERSE_FEES = { 'Level 1': 167, 'Level 2': 218, 'Level 3': 259, 'Level 4': 331 };
const COLL_FEE_DATA = {
  'Kurta Sets':     [0, 5, 19, 27, 27, 45, 61],
  'Kurtas':         [15, 17, 27, 27, 27, 45, 61],
};
const LOGISTICS_SETTINGS = { myn_pg_fee: 50.22 };
function autoGST(sp) { return sp >= 2500 ? 0.18 : 0.05; }
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

// runWFEngine is stubbed per-test
let stubResult = {};
function runWFEngine() { return stubResult; }

// ── calcMyntraFull copied verbatim from index.html:6776 ─────────────
function calcMyntraFull(cost, markup, discPct, level, cat, incPct, retPct){
  const result = runWFEngine('myntra', {
    cost, margin: markup, markup, discount: discPct||0,
    level: level||'Level 2', cat: cat||'Kurta Sets',
    retPct: retPct||0
  });
  const mrp      = result.mrp      ?? Math.round(cost*(1+markup/100));
  const mrpRnd   = mrp;
  const custPaid = result.custPaid ?? mrp;
  const gtCharge = result.gtCharge ?? 0;
  const sellerPrice = result.sellerPrice ?? custPaid;
  const gst      = result.gstRate  ?? autoGST(custPaid);
  const rawComm  = result.commPct  ?? 0;
  const commAmt  = result.commAmt  ?? 0;
  const gstAmt   = result.gstOnComm ?? 0;
  const taxableAmt = result.taxableAmt ?? sellerPrice/(1+gst);
  const tcs      = result.tcs      ?? taxableAmt*0.001;
  const tds      = result.tds      ?? taxableAmt*0.005;
  const ret      = result.retFee   ?? REVERSE_FEES[level] ?? 218;
  const coll     = result.collFee  ?? getMynColl(cat, sellerPrice);
  const pg       = result.pgFee    ?? LOGISTICS_SETTINGS.myn_pg_fee ?? 50.22;
  const retProv  = result.retProv  ?? 0;
  const payout   = result.expectedPayment ?? result.payout ?? (sellerPrice-commAmt-gstAmt-ret-coll-pg-retProv-tcs-tds);
  const profit   = result.profit   ?? (payout-cost);
  const ifDelivered = result.ifDelivered ?? (profit + ret);
  const grossSettlement = result.grossSettlement ?? (sellerPrice - commAmt - (coll * 1.18));
  const profitPct= custPaid>0 ? (profit/custPaid*100).toFixed(1) : '0';
  return {mrp,mrpRnd,custPaid,gtCharge,sellerPrice,gst,gstRate:gst,rawComm,
          commAmt,gstAmt,gstOnComm:gstAmt,taxableAmt,tcs,tds,ret,retFee:ret,coll,collFee:coll,
          pg,pgFee:pg,retProv,payout,profit,ifDelivered,grossSettlement,profitPct};
}

// ════════════════════════════════════════════════════════════
describe('calcMyntraFull — result mapping with full engine output', () => {
  it('passes through every engine field when present', () => {
    stubResult = {
      mrp: 1500, custPaid: 1450, sellerPrice: 1200, gtCharge: 50,
      gstRate: 0.05, commPct: 18.88, commAmt: 226.56, gstOnComm: 40.78,
      taxableAmt: 1142.86, tcs: 1.14, tds: 5.71,
      retFee: 218, collFee: 27, pgFee: 50.22, retProv: 0,
      expectedPayment: 850, profit: 350,
      ifDelivered: 568, grossSettlement: 1142,
    };
    const r = calcMyntraFull(500, 200, 30, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.mrp).toBe(1500);
    expect(r.mrpRnd).toBe(1500);
    expect(r.custPaid).toBe(1450);
    expect(r.sellerPrice).toBe(1200);
    expect(r.gtCharge).toBe(50);
    expect(r.gst).toBe(0.05);
    expect(r.gstRate).toBe(0.05);
    expect(r.rawComm).toBe(18.88);
    expect(r.commAmt).toBe(226.56);
    expect(r.gstAmt).toBe(40.78);
    expect(r.gstOnComm).toBe(40.78);
    expect(r.taxableAmt).toBe(1142.86);
    expect(r.tcs).toBe(1.14);
    expect(r.tds).toBe(5.71);
    expect(r.ret).toBe(218);
    expect(r.retFee).toBe(218);
    expect(r.coll).toBe(27);
    expect(r.collFee).toBe(27);
    expect(r.pg).toBe(50.22);
    expect(r.pgFee).toBe(50.22);
    expect(r.retProv).toBe(0);
    expect(r.payout).toBe(850);
    expect(r.profit).toBe(350);
    expect(r.ifDelivered).toBe(568);
    expect(r.grossSettlement).toBe(1142);
    expect(r.profitPct).toBe('24.1'); // 350 / 1450 * 100 = 24.13...
  });

  it('prefers expectedPayment over payout when both present', () => {
    stubResult = { expectedPayment: 100, payout: 999 };
    const r = calcMyntraFull(500, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.payout).toBe(100);
  });

  it('uses payout when expectedPayment is undefined', () => {
    stubResult = { payout: 500 };
    const r = calcMyntraFull(100, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.payout).toBe(500);
  });
});

describe('calcMyntraFull — fallbacks when engine returns minimal output', () => {
  it('mrp falls back to Math.round(cost * (1 + markup/100))', () => {
    stubResult = {};
    const r = calcMyntraFull(500, 200, 0, 'Level 2', 'Kurta Sets', 0, 0);
    // round(500 * 3) = 1500
    expect(r.mrp).toBe(1500);
    expect(r.mrpRnd).toBe(1500);
  });

  it('custPaid falls back to mrp', () => {
    stubResult = { mrp: 1500 };
    const r = calcMyntraFull(500, 200, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.custPaid).toBe(1500);
  });

  it('sellerPrice falls back to custPaid', () => {
    stubResult = { mrp: 1500, custPaid: 1400 };
    const r = calcMyntraFull(500, 200, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.sellerPrice).toBe(1400);
  });

  it('gst falls back to autoGST(custPaid)', () => {
    stubResult = { custPaid: 3000 };
    const r = calcMyntraFull(500, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.gst).toBe(0.18); // 3000 >= 2500
  });

  it('gst falls back to 5% when custPaid is below the GST boundary', () => {
    stubResult = { custPaid: 1500 };
    const r = calcMyntraFull(500, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.gst).toBe(0.05);
  });

  it('taxableAmt falls back to sellerPrice / (1 + gst)', () => {
    stubResult = { sellerPrice: 1180, gstRate: 0.18 };
    const r = calcMyntraFull(500, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.taxableAmt).toBeCloseTo(1000, 6); // 1180 / 1.18 = 1000
  });

  it('tcs falls back to taxableAmt * 0.001', () => {
    stubResult = { taxableAmt: 1000 };
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.tcs).toBe(1); // 1000 * 0.001
  });

  it('tds falls back to taxableAmt * 0.005', () => {
    stubResult = { taxableAmt: 1000 };
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.tds).toBe(5);
  });

  it('ret falls back to REVERSE_FEES[level]', () => {
    stubResult = {};
    expect(calcMyntraFull(0, 0, 0, 'Level 1', 'Kurta Sets', 0, 0).ret).toBe(167);
    expect(calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0).ret).toBe(218);
    expect(calcMyntraFull(0, 0, 0, 'Level 3', 'Kurta Sets', 0, 0).ret).toBe(259);
    expect(calcMyntraFull(0, 0, 0, 'Level 4', 'Kurta Sets', 0, 0).ret).toBe(331);
  });

  it('ret falls back to 218 when level is unknown', () => {
    stubResult = {};
    const r = calcMyntraFull(0, 0, 0, 'Level 999', 'Kurta Sets', 0, 0);
    expect(r.ret).toBe(218);
  });

  it('coll falls back to getMynColl(cat, sellerPrice)', () => {
    stubResult = { sellerPrice: 600 };
    // Kurta Sets at sp=600 → slab 2 → ₹19
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.coll).toBe(19);
  });

  it('pg falls back to LOGISTICS_SETTINGS.myn_pg_fee', () => {
    stubResult = {};
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.pg).toBe(50.22);
  });

  it('payout falls back to a derived formula when engine returns neither expectedPayment nor payout', () => {
    stubResult = {
      sellerPrice: 1000, commAmt: 100, gstOnComm: 20,
      retFee: 50, collFee: 30, pgFee: 10, retProv: 0,
      tcs: 1, tds: 5,
    };
    // 1000 - 100 - 20 - 50 - 30 - 10 - 0 - 1 - 5 = 784
    const r = calcMyntraFull(500, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.payout).toBe(784);
  });

  it('profit falls back to payout - cost', () => {
    stubResult = { payout: 800 };
    const r = calcMyntraFull(300, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.profit).toBe(500);
  });

  it('ifDelivered falls back to profit + ret', () => {
    stubResult = { profit: 300, retFee: 218 };
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.ifDelivered).toBe(518);
  });

  it('grossSettlement falls back to sellerPrice - commAmt - (coll * 1.18)', () => {
    stubResult = { sellerPrice: 1000, commAmt: 200, collFee: 27 };
    // 1000 - 200 - (27 * 1.18) = 800 - 31.86 = 768.14
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.grossSettlement).toBeCloseTo(768.14, 6);
  });

  it('profitPct returns "0" string when custPaid is 0', () => {
    stubResult = { custPaid: 0, profit: 50 };
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.profitPct).toBe('0');
  });

  it('profitPct is computed as (profit / custPaid * 100).toFixed(1)', () => {
    stubResult = { custPaid: 1000, profit: 250 };
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.profitPct).toBe('25.0');
  });
});

describe('calcMyntraFull — preserves 0 and negative values via ?? not ||', () => {
  it('preserves 0 from engine output (does not fall back)', () => {
    stubResult = { commPct: 0, commAmt: 0, gstOnComm: 0, retFee: 0, collFee: 0, pgFee: 0 };
    const r = calcMyntraFull(0, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.rawComm).toBe(0);
    expect(r.commAmt).toBe(0);
    expect(r.gstAmt).toBe(0);
    expect(r.ret).toBe(0);
    expect(r.coll).toBe(0);
    expect(r.pg).toBe(0);
  });

  it('preserves negative profit (does not fall back to payout - cost)', () => {
    stubResult = { payout: 100, profit: -200 };
    const r = calcMyntraFull(500, 0, 0, 'Level 2', 'Kurta Sets', 0, 0);
    expect(r.profit).toBe(-200);
  });
});

describe('calcMyntraFull — input default handling', () => {
  it('level defaults to "Level 2" when called with undefined', () => {
    stubResult = {};
    const r = calcMyntraFull(0, 0, 0, undefined, 'Kurta Sets', 0, 0);
    expect(r.ret).toBe(218); // REVERSE_FEES['Level 2']
  });

  it('discPct defaults to 0 when undefined', () => {
    // (we can't observe this directly without WF rules, but at minimum
    // it doesn't crash)
    stubResult = {};
    expect(() => calcMyntraFull(0, 0, undefined, 'Level 2', 'Kurta Sets', 0, 0)).not.toThrow();
  });
});
