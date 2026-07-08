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
