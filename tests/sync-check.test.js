import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Drift detection: every other test file in tests/calc/ copies code
// from index.html with a SYNC NOTE comment. If someone changes
// the production source but forgets to update the test copy, the
// test would silently keep passing against stale logic.
//
// This file fixes that by asserting the exact production source
// strings (for one-line functions / data definitions) still appear
// verbatim in index.html. If any of these assertions fails:
//
//   1. Open the test file mentioned in the failure
//   2. Update the copied function/data to match what's now in index.html
//   3. Update the assertion below to match the new production string

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('source drift detection — production strings must match test copies', () => {
  describe('one-line functions', () => {
    it('autoGST is unchanged (tests/calc/gst.test.js)', () => {
      expect(HTML).toContain(
        'function autoGST(sp){return sp>=2500?0.18:0.05;}'
      );
    });

    it('getMynRet is unchanged (tests/calc/myntra-fees.test.js)', () => {
      expect(HTML).toContain(
        `function getMynRet(level, cat, price){
  const mode = LOGISTICS_SETTINGS.myn_ret_mode || 'level';
  if(mode==='fixed') return +LOGISTICS_SETTINGS.myn_ret_fixed || 218;
  if(mode==='cat' && cat && REV_CAT_DATA[cat]!=null) return slabPick(REV_SLABS, REV_CAT_DATA[cat], price);
  return slabPick(REV_SLABS, REVERSE_FEES[level]??218, price);
}`
      );
    });

    it('gtSlabValue is unchanged (tests/calc/myntra-fees.test.js)', () => {
      expect(HTML).toContain(
        'function gtSlabValue(slabs, sp){ return slabPick(GT_SLABS, slabs, sp); }'
      );
    });

    it('getMynFwd is unchanged (tests/calc/myntra-fees.test.js)', () => {
      expect(HTML).toContain(
        `function getMynFwd(level, sp, cat){
  const mode = LOGISTICS_SETTINGS.myn_fwd_mode || 'level';
  if(mode==='fixed') return +LOGISTICS_SETTINGS.myn_fwd_fixed || 0;
  if(mode==='cat' && cat && GT_CAT_DATA[cat]) return gtSlabValue(GT_CAT_DATA[cat], sp);
  return gtSlabValue(GT_DATA[level] || GT_DATA['Level 2'] || [0,1,83,83,118,195,230], sp);
}`
      );
    });

    it('getMynColl is unchanged (tests/calc/myntra-fees.test.js)', () => {
      expect(HTML).toContain(
        `function getMynColl(cat, sellerPrice){
  const slabs=COLL_FEE_DATA[cat]||[15,17,27,27,27,45,61];
  const p=sellerPrice||0;
  const cb=COLL_CAT_SLABS?COLL_CAT_SLABS[cat]:null;
  if(Array.isArray(cb)){
    for(let i=0;i<cb.length;i++){
      if(p<=cb[i]) return +slabs[Math.min(i,slabs.length-1)]||0;
    }
    return +slabs[Math.min(cb.length,slabs.length-1)]||0;
  }
  for(let i=0;i<COLL_SLABS.length;i++){
    if(p<=COLL_SLABS[i]) return +slabs[Math.min(i,slabs.length-1)]||0;
  }
  return +slabs[Math.min(COLL_SLABS.length,slabs.length-1)]||0;
}`
      );
    });

    it('slabPick is unchanged (tests/calc/myntra-fees.test.js)', () => {
      expect(HTML).toContain(
        `function slabPick(bounds, values, price){
  if(!Array.isArray(values)) return +values||0;
  if(!values.length) return 0;
  const p=price||0;
  for(let i=0;i<bounds.length;i++){
    if(p<=bounds[i]) return +values[Math.min(i,values.length-1)]||0;
  }
  return +values[Math.min(bounds.length,values.length-1)]||0;
}`
      );
    });

    it('getMyntraComm is unchanged (tests/calc/myntra-commission.test.js)', () => {
      expect(HTML).toContain(
        `function getMyntraComm(cat,sp){
  if(COMM_MODE==='slab'&&COMM_SLAB_CAT&&COMM_SLAB_CAT[cat]){
    const o=COMM_SLAB_CAT[cat];
    if(Array.isArray(o.bounds)&&o.bounds.length&&Array.isArray(o.rates)&&o.rates.length){
      for(let i=0;i<o.bounds.length;i++){if(sp<o.bounds[i])return +o.rates[Math.min(i,o.rates.length-1)]||0;}
      return +o.rates[Math.min(o.bounds.length,o.rates.length-1)]||0;
    }
  }
  const slabs=COMM_MODE==='slab'?COMM_SLAB_ONLY:COMM_MYNTRA[cat];
  if(!slabs||!slabs.length)return 18.88;
  const cb=COMM_MODE!=='slab'&&COMM_CAT_SLABS?COMM_CAT_SLABS[cat]:null;
  if(cb&&cb.length){
    for(let i=0;i<cb.length;i++){if(sp<cb[i])return +slabs[Math.min(i,slabs.length-1)]||0;}
    return +slabs[Math.min(cb.length,slabs.length-1)]||0;
  }
  for(let i=0;i<SLABS.length;i++){
    if(sp>=SLABS[i].min&&sp<SLABS[i].max)return +slabs[Math.min(i,slabs.length-1)];
  }
  return +slabs[slabs.length-1];
}`
      );
    });
  });

  // The three biggest calc functions are copied wholesale into tests/calc/,
  // but until now nothing asserted those copies stayed in sync — which is
  // exactly how calc-sku.test.js drifted from the dangling-brand warning
  // without a single test going red. Whole-body literals for functions this
  // size would be unmaintainable, so assert the load-bearing slices: the
  // branch dispatch, the money arithmetic, and the fallbacks that read
  // globals directly.
  describe('large calc functions (slice assertions)', () => {
    it('calcSKU brand resolution + fallback is unchanged (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain('const realBrand=brands.find(b=>b.id===s.brandId);');
      expect(HTML).toContain("const brand=realBrand||{model:'myntra',commOverride:null};");
      expect(HTML).toContain("const mp = brand.model || 'myntra';");
      expect(HTML).toContain("const level = CAT_LEVEL[s.category] || s.level || 'Level 2';");
    });

    it('withBrandCfg swap/restore is unchanged (tests/calc/calc-sku.test.js)', () => {
      // The zero-diff guarantee depends on the inherit path being a plain
      // call through, and on the finally-block restore being unconditional.
      expect(HTML).toContain('function withBrandCfg(brandId, fn){');
      expect(HTML).toContain('  const ov=resolveBrandCfg(brandId);');
      expect(HTML).toContain('  if(!ov) return fn();');
      expect(HTML).toContain(
        "  if(_cfgDepth) throw new Error('withBrandCfg: nested config scope — calculations must not nest');"
      );
      expect(HTML).toContain('  try{ return fn(); }');
      expect(HTML).toContain('    for(const k in saved) CFG_REG[k].set(saved[k]);');
    });

    it('calcSKU prices inside the brand config scope (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain('withBrandCfg(brand.id, ()=>{');
    });

    it('CFG_REG covers every swappable config global (tests/calc/calc-sku.test.js)', () => {
      // Getters must be closures — these globals are reassigned wholesale on
      // load/realtime/import, so a captured snapshot would go stale.
      expect(HTML).toContain(
        '  COMM_SLABS:     {get:()=>COMM_SLABS,     set:v=>{COMM_SLABS=v;SLABS=_slabsFromBounds(v);}},'
      );
      expect(HTML).toContain(
        "const _lsKey=k=>({get:()=>LOGISTICS_SETTINGS[k],set:v=>{LOGISTICS_SETTINGS[k]=v;}});"
      );
      for (const k of ['COMM_MODE','COMM_SLAB_ONLY','COMM_MYNTRA','COMM_CAT_SLABS','COMM_SLAB_CAT',
                       'COMM_AMAZON','COMM_AJIO_PPMP','COMM_AJIO_CC','GT_SLABS','GT_DATA',
                       'GT_CAT_DATA','REV_SLABS','REVERSE_FEES','REV_CAT_DATA','COLL_SLABS',
                       'COLL_CAT_SLABS','COLL_FEE_DATA']) {
        expect(HTML, `CFG_REG is missing ${k}`).toContain(`  ${k}:`);
      }
    });

    it('config sections stay closed under indexing (tests/calc/calc-sku.test.js)', () => {
      // A bounds array and every rate array indexed by it MUST share a
      // section, or a brand could override bounds while inheriting rates and
      // the Math.min clamps would silently return the wrong band.
      expect(HTML).toContain(
        "  comm:['COMM_MODE','COMM_SLABS','COMM_SLAB_ONLY','COMM_MYNTRA','COMM_CAT_SLABS','COMM_SLAB_CAT','COMM_AMAZON','COMM_AJIO_PPMP','COMM_AJIO_CC'],"
      );
      expect(HTML).toContain("  fwd :['GT_SLABS','GT_DATA','GT_CAT_DATA','myn_fwd_mode','myn_fwd_fixed'],");
      expect(HTML).toContain("  ret :['REV_SLABS','REVERSE_FEES','REV_CAT_DATA','myn_ret_mode','myn_ret_fixed','amz_ret'],");
      expect(HTML).toContain("  coll:['COLL_SLABS','COLL_CAT_SLABS','COLL_FEE_DATA'],");
      expect(HTML).toContain("  fees:['myn_pg_fee','ajio_fwd','ajio_ret','ajio_platform_fee','amz_fba','amz_close'],");
    });

    it('showCalcModal uses the same brand scope as calcSKU (no contradiction)', () => {
      expect(HTML).toContain('const result=withBrandCfg(brand.id,()=>runWFEngine(mp,inputs));');
    });

    it('calcSKU marketplace dispatch is unchanged (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain("if(mp==='myntra'){");
      expect(HTML).toContain("} else if(mp==='ajio-ppmp'||mp==='ajio-cc'){");
      expect(HTML).toContain(
        'const v2=calcMyntraFull(s.cost,s.markup,s.discount??0,level,s.category,0,0);'
      );
    });

    it('calcSKU Ajio branch arithmetic is unchanged (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain('const profitInclCost=Math.round(s.cost + s.cost * s.markup / 100);');
      expect(HTML).toContain('const gstRate=grossSale>2500?0.18:0.05;');
      expect(HTML).toContain('const gstValue=grossSale*gstRate/(1+gstRate);');
      expect(HTML).toContain('const purchasePrice=mrpRnd-discAmt-gstValue-commAmt;');
      expect(HTML).toContain('const marketingContr=invoiceValue*0.03;');
      expect(HTML).toContain(
        'const logistic=(LOGISTICS_SETTINGS.ajio_fwd||70)+(LOGISTICS_SETTINGS.ajio_ret||70);'
      );
    });

    it('calcSKU Amazon branch arithmetic is unchanged (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain('sp=Math.round(mrp*3/100)*100||mrp*3;');
      expect(HTML).toContain('else comm=COMM_AMAZON[s.category]||17;');
      expect(HTML).toContain(
        'const fba=LOGISTICS_SETTINGS.amz_fba,close=LOGISTICS_SETTINGS.amz_close,allFees=commAmt+close+fba,gstAmt2=allFees*gst;'
      );
      expect(HTML).toContain('payout=sp-allFees-gstAmt2;');
    });

    it('calcSKU result shape is unchanged (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain(
        'const result={mrp,sp,custPaid,comm,payout,profitRs,profitPct,isBreach,threshold,ifDelivered,grossSettlement};'
      );
      expect(HTML).toContain('const isBreach=!s.ignoreThreshold&&profitRs<threshold;');
    });

    it('calcMyntraFull signature + global-reading fallbacks unchanged (tests/calc/myntra-full-wrapper.test.js)', () => {
      expect(HTML).toContain(
        'function calcMyntraFull(cost, markup, discPct, level, cat, incPct, retPct){'
      );
      // These three read globals OUTSIDE the WF engine, so they are the
      // fallbacks a per-brand config swap must also cover.
      expect(HTML).toContain('const ret      = result.retFee   ?? REVERSE_FEES[level] ?? 218;');
      expect(HTML).toContain('const coll     = result.collFee  ?? getMynColl(cat, sellerPrice);');
      expect(HTML).toContain(
        'const pg       = result.pgFee    ?? LOGISTICS_SETTINGS.myn_pg_fee ?? 50.22;'
      );
      expect(HTML).toContain(
        'const grossSettlement = result.grossSettlement ?? (sellerPrice - commAmt - (coll * 1.18));'
      );
    });

    it('runWFEngine dispatch + compile path unchanged (tests/calc/wf-engine.test.js)', () => {
      expect(HTML).toContain('function runWFEngine(marketplace, inputs){');
      expect(HTML).toContain('const rows = WF[marketplace] || [];');
      expect(HTML).toContain(
        'ctx[row.var] = WF_LOOKUPS[row.fn] ? WF_LOOKUPS[row.fn](ctx) : null;'
      );
      expect(HTML).toContain('const validIdRe = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;');
      expect(HTML).toContain('const fn = _wfCompile(keys, row.expr);');
      expect(HTML).toContain(
        'ctx[row.var] = (typeof r === \'number\' && isNaN(r)) || r == null ? null : r;'
      );
    });
  });

  describe('inline lookup tables', () => {
    it('SLABS derivation is unchanged (tests/calc/myntra-commission.test.js)', () => {
      expect(HTML).toContain('let COMM_SLABS=[300,500,1000,2000];');
      expect(HTML).toContain(
        `function _slabsFromBounds(bounds){
  const out=[];let prev=0;
  bounds.forEach(b=>{out.push({label:\`\${prev}–\${b}\`,min:prev,max:b});prev=b;});
  out.push({label:prev+'+',min:prev,max:Infinity});
  return out;
}`
      );
      expect(HTML).toContain('let SLABS=_slabsFromBounds(COMM_SLABS);');
    });

    it('COMM_AMAZON is unchanged (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain(
        "let COMM_AMAZON={'Kurta Sets':17.0,'Lehenga Choli':19.0,'Ethnic Dresses':17.0,'Sarees':17.0,'Co-Ords':17.0,'Jumpsuit':17.0,'Tops':17.0,'Kurtas':17.0};"
      );
    });

    it('COMM_MYNTRA is unchanged (tests/calc/myntra-commission.test.js)', () => {
      expect(HTML).toContain(
        "let COMM_MYNTRA={'Kurta Sets':[0,0,21.24,17.70,18.88],'Lehenga Choli':[0,0,28.32,18.88,18.88],'Ethnic Dresses':[0,7.08,23.60,20.06,22.42],'Sarees':[0,0,23.60,20.06,22.42],'Co-Ords':[0,4.72,23.60,20.06,21.24],'Jumpsuit':[0,2.36,23.60,20.06,21.24],'Tops':[0,0,22.42,21.24,18.88],'Kurtas':[0,0,21.24,17.70,18.88]};"
      );
    });

    it('THRESHOLDS keys/values are unchanged (tests/calc/calc-sku.test.js)', () => {
      // THRESHOLDS spans multiple lines in source; assert each key:value pair.
      expect(HTML).toContain("'Kurta Sets':300");
      expect(HTML).toContain("'Lehenga Choli':500");
      expect(HTML).toContain("'Ethnic Dresses':250");
      expect(HTML).toContain("'Sarees':300");
      expect(HTML).toContain("'Co-Ords':250");
      expect(HTML).toContain("'Jumpsuit':250");
      expect(HTML).toContain("'Tops':150");
      expect(HTML).toContain("'Kurtas':300");
    });

    it('REVERSE_FEES is unchanged (tests/calc/myntra-fees.test.js)', () => {
      expect(HTML).toContain(
        "let REVERSE_FEES = {\n  'Level 1': 167, 'Level 2': 218, 'Level 3': 259, 'Level 4': 331\n};"
      );
    });

    it('CAT_LEVEL key/value pairs are unchanged (tests/calc/calc-sku.test.js)', () => {
      expect(HTML).toContain("'Kurtas':         'Level 2',");
      expect(HTML).toContain("'Kurta Sets':     'Level 2',");
      expect(HTML).toContain("'Sarees':         'Level 2',");
      expect(HTML).toContain("'Lehenga Choli':  'Level 4',");
      expect(HTML).toContain("'Ethnic Dresses': 'Level 1',");
      expect(HTML).toContain("'Co-Ords':        'Level 1',");
      expect(HTML).toContain("'Jumpsuit':       'Level 1',");
      expect(HTML).toContain("'Tops':           'Level 1',");
      expect(HTML).toContain("'Dresses':        'Level 1',");
    });

    it('LOGISTICS_SETTINGS amz_fba/amz_close/myn_pg_fee unchanged (multiple test files)', () => {
      expect(HTML).toContain('myn_pg_fee: 50.22');
      expect(HTML).toContain('ajio_fwd: 70');
      expect(HTML).toContain('ajio_ret: 70');
      expect(HTML).toContain('amz_fba: 55');
      expect(HTML).toContain('amz_close: 15');
    });
  });

  describe('security-critical function: sanitizeExpr blocked-token regex', () => {
    it('blocked-token regex is unchanged (tests/calc/wf-engine.test.js)', () => {
      expect(HTML).toContain(
        "const blocked = /[;{}\\[\\]\\\\`]|((^|[^=!<>])=([^=>]|$))|(\\b(eval|Function|constructor|prototype|__proto__|import|require|fetch|XMLHttpRequest|document|window|globalThis|self|location|localStorage|sessionStorage|history|navigator|top|parent|open|Object|Reflect|Proxy|crypto|indexedDB|caches|postMessage|alert|prompt|confirm|setTimeout|setInterval|setImmediate|arguments|await|async|new|class|function|this|delete|void|typeof|instanceof|with|debugger|yield|throw|try|catch|finally)\\b)/;"
      );
    });
  });
});
