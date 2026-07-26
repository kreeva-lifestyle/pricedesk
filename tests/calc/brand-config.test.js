import { describe, it, expect, beforeEach, vi } from 'vitest';

// SYNC NOTE: the per-brand config resolver is copied verbatim from
// index.html below, along with the section map and a registry over the
// globals it reads. If you change any of these in index.html, update this
// file too — tests/sync-check.test.js asserts the production strings.
//
//   - CFG_SECTIONS:       index.html:3556
//   - CFG_CAT_KEYED:      index.html:3625
//   - resolveBrandCfg:    index.html:3634
//   - _buildBrandCfg:     index.html:3644
//   - _sanitizeBrandCfg:  index.html:3681
//
// These matter because a malformed brand config must never break pricing:
// getMyntraComm and getMynColl clamp their band index with Math.min, so a
// rate row that is shorter than its bounds array silently returns the WRONG
// band rather than throwing. Every guard below exists to prevent that.

// ── globals the registry swaps (all `let`, as in production) ──
let COMM_MODE = 'level_slab';
let COMM_SLABS = [300, 500, 1000, 2000];
let SLABS = _slabsFromBounds(COMM_SLABS);
let COMM_SLAB_ONLY = [0, 0, 21.24, 17.7, 18.88];
let COMM_MYNTRA = { 'Kurta Sets': [0, 0, 21.24, 17.7, 18.88], 'Sarees': [0, 0, 23.6, 20.06, 22.42] };
let COMM_CAT_SLABS = {};
let COMM_SLAB_CAT = {};
let COMM_AMAZON = { 'Kurta Sets': 17, 'Sarees': 17 };
let COMM_AJIO_PPMP = { 'Kurta Sets': 18.88 };
let COMM_AJIO_CC = { 'Kurta Sets': 18.88 };
let GT_SLABS = [1, 99, 300, 500, 1000, 2000];
let GT_DATA = { 'Level 2': [0, 1, 83, 83, 118, 195, 230] };
let GT_CAT_DATA = {};
let REV_SLABS = [];
let REVERSE_FEES = { 'Level 1': 167, 'Level 2': 218 };
let REV_CAT_DATA = {};
let COLL_SLABS = [300, 500, 700, 800, 1000, 2000];
let COLL_CAT_SLABS = {};
let COLL_FEE_DATA = { 'Sarees': [0, 3, 26, 27, 27, 45, 61] };
let LOGISTICS_SETTINGS = {
  myn_pg_fee: 50.22, myn_fwd_mode: 'level', myn_ret_mode: 'level',
  myn_fwd_fixed: 230, myn_ret_fixed: 218,
  ajio_fwd: 70, ajio_ret: 70, ajio_platform_fee: 0,
  amz_fba: 55, amz_close: 15, amz_ret: 55,
};
let brands = [];
let _calcCacheVersion = 0;

function _slabsFromBounds(bounds) {
  const out = []; let prev = 0;
  bounds.forEach(b => { out.push({ label: `${prev}–${b}`, min: prev, max: b }); prev = b; });
  out.push({ label: prev + '+', min: prev, max: Infinity });
  return out;
}

// ── copied from index.html ────────────────────────────────────
const CFG_SECTIONS = {
  comm: ['COMM_MODE', 'COMM_SLABS', 'COMM_SLAB_ONLY', 'COMM_MYNTRA', 'COMM_CAT_SLABS', 'COMM_SLAB_CAT', 'COMM_AMAZON', 'COMM_AJIO_PPMP', 'COMM_AJIO_CC'],
  fwd: ['GT_SLABS', 'GT_DATA', 'GT_CAT_DATA', 'myn_fwd_mode', 'myn_fwd_fixed'],
  ret: ['REV_SLABS', 'REVERSE_FEES', 'REV_CAT_DATA', 'myn_ret_mode', 'myn_ret_fixed', 'amz_ret'],
  coll: ['COLL_SLABS', 'COLL_CAT_SLABS', 'COLL_FEE_DATA'],
  fees: ['myn_pg_fee', 'ajio_fwd', 'ajio_ret', 'ajio_platform_fee', 'amz_fba', 'amz_close'],
};
const _lsKey = k => ({ get: () => LOGISTICS_SETTINGS[k], set: v => { LOGISTICS_SETTINGS[k] = v; } });
const CFG_REG = {
  COMM_MODE: { get: () => COMM_MODE, set: v => { COMM_MODE = v; } },
  COMM_SLABS: { get: () => COMM_SLABS, set: v => { COMM_SLABS = v; SLABS = _slabsFromBounds(v); } },
  COMM_SLAB_ONLY: { get: () => COMM_SLAB_ONLY, set: v => { COMM_SLAB_ONLY = v; } },
  COMM_MYNTRA: { get: () => COMM_MYNTRA, set: v => { COMM_MYNTRA = v; } },
  COMM_CAT_SLABS: { get: () => COMM_CAT_SLABS, set: v => { COMM_CAT_SLABS = v; } },
  COMM_SLAB_CAT: { get: () => COMM_SLAB_CAT, set: v => { COMM_SLAB_CAT = v; } },
  COMM_AMAZON: { get: () => COMM_AMAZON, set: v => { COMM_AMAZON = v; } },
  COMM_AJIO_PPMP: { get: () => COMM_AJIO_PPMP, set: v => { COMM_AJIO_PPMP = v; } },
  COMM_AJIO_CC: { get: () => COMM_AJIO_CC, set: v => { COMM_AJIO_CC = v; } },
  GT_SLABS: { get: () => GT_SLABS, set: v => { GT_SLABS = v; } },
  GT_DATA: { get: () => GT_DATA, set: v => { GT_DATA = v; } },
  GT_CAT_DATA: { get: () => GT_CAT_DATA, set: v => { GT_CAT_DATA = v; } },
  REV_SLABS: { get: () => REV_SLABS, set: v => { REV_SLABS = v; } },
  REVERSE_FEES: { get: () => REVERSE_FEES, set: v => { REVERSE_FEES = v; } },
  REV_CAT_DATA: { get: () => REV_CAT_DATA, set: v => { REV_CAT_DATA = v; } },
  COLL_SLABS: { get: () => COLL_SLABS, set: v => { COLL_SLABS = v; } },
  COLL_CAT_SLABS: { get: () => COLL_CAT_SLABS, set: v => { COLL_CAT_SLABS = v; } },
  COLL_FEE_DATA: { get: () => COLL_FEE_DATA, set: v => { COLL_FEE_DATA = v; } },
  myn_fwd_mode: _lsKey('myn_fwd_mode'), myn_fwd_fixed: _lsKey('myn_fwd_fixed'),
  myn_ret_mode: _lsKey('myn_ret_mode'), myn_ret_fixed: _lsKey('myn_ret_fixed'),
  amz_ret: _lsKey('amz_ret'), myn_pg_fee: _lsKey('myn_pg_fee'),
  ajio_fwd: _lsKey('ajio_fwd'), ajio_ret: _lsKey('ajio_ret'),
  ajio_platform_fee: _lsKey('ajio_platform_fee'),
  amz_fba: _lsKey('amz_fba'), amz_close: _lsKey('amz_close'),
};

const CFG_CAT_KEYED = new Set(['COMM_MYNTRA', 'COMM_AMAZON', 'COMM_AJIO_PPMP', 'COMM_AJIO_CC',
  'COMM_CAT_SLABS', 'COMM_SLAB_CAT', 'GT_CAT_DATA', 'REV_CAT_DATA', 'COLL_FEE_DATA', 'COLL_CAT_SLABS']);
const CFG_LEVEL_KEYED = new Set(['GT_DATA', 'REVERSE_FEES']);

let _brandCfgCache = new Map();

function resolveBrandCfg(brandId) {
  if (!brandId) return null;
  const ck = brandId + '|' + _calcCacheVersion;
  if (_brandCfgCache.has(ck)) return _brandCfgCache.get(ck);
  const out = _buildBrandCfg(brandId);
  _brandCfgCache.set(ck, out);
  return out;
}

function _buildBrandCfg(brandId) {
  const b = brands.find(x => x.id === brandId);
  const cfg = b && b.config;
  if (!cfg || typeof cfg !== 'object') return null;
  const out = {};
  for (const [section, keys] of Object.entries(CFG_SECTIONS)) {
    const sec = cfg[section];
    if (!sec || typeof sec !== 'object') continue;
    for (const k of keys) {
      const slot = CFG_REG[k];
      if (!slot) continue;
      const base = slot.get();
      let v = sec[k];
      if (v === undefined || v === null) { out[k] = base; continue; }
      if (CFG_CAT_KEYED.has(k) || CFG_LEVEL_KEYED.has(k)) {
        if (typeof v !== 'object' || Array.isArray(v)) { out[k] = base; continue; }
        out[k] = Object.assign({}, base && typeof base === 'object' ? base : {}, v);
      } else {
        out[k] = v;
      }
    }
  }
  const resolved = _sanitizeBrandCfg(out, brandId);
  return Object.keys(resolved).length ? resolved : null;
}

function _sanitizeBrandCfg(out, brandId) {
  const warn = m => {
    if (!_sanitizeBrandCfg._warned) _sanitizeBrandCfg._warned = new Set();
    const k = brandId + '|' + m;
    if (_sanitizeBrandCfg._warned.has(k)) return;
    _sanitizeBrandCfg._warned.add(k);
    console.warn(`Brand ${brandId} config: ${m}`);
  };
  const ascending = a => Array.isArray(a) && a.every((v, i) => typeof v === 'number' && isFinite(v) && v > 0 && (i === 0 || v > a[i - 1]));
  for (const k of ['COMM_SLABS', 'GT_SLABS', 'COLL_SLABS']) {
    if (k in out && !(ascending(out[k]) && out[k].length)) { warn(`${k} is not an ascending list of positive numbers — using the global instead`); out[k] = CFG_REG[k].get(); }
  }
  if ('REV_SLABS' in out && !(Array.isArray(out.REV_SLABS) && (out.REV_SLABS.length === 0 || ascending(out.REV_SLABS)))) {
    warn('REV_SLABS is not an ascending list — using the global instead'); out.REV_SLABS = CFG_REG.REV_SLABS.get();
  }
  for (const k of ['COLL_CAT_SLABS', 'COMM_CAT_SLABS']) {
    if (!(k in out) || !out[k] || typeof out[k] !== 'object') continue;
    const clean = {};
    for (const [cat, bnd] of Object.entries(out[k])) {
      if (Array.isArray(bnd) && (bnd.length === 0 || ascending(bnd))) clean[cat] = bnd;
      else warn(`${k}["${cat}"] is malformed — that category falls back to the global bounds`);
    }
    out[k] = clean;
  }
  if ('COMM_MODE' in out && out.COMM_MODE !== 'slab' && out.COMM_MODE !== 'level_slab') {
    warn('COMM_MODE is not "slab" or "level_slab" — using the global instead'); out.COMM_MODE = CFG_REG.COMM_MODE.get();
  }
  for (const k of ['myn_pg_fee', 'myn_fwd_fixed', 'myn_ret_fixed', 'ajio_fwd', 'ajio_ret',
    'ajio_platform_fee', 'amz_fba', 'amz_close', 'amz_ret']) {
    if (k in out && !(typeof out[k] === 'number' && isFinite(out[k]))) { warn(`${k} is not a number — using the global instead`); out[k] = CFG_REG[k].get(); }
  }
  for (const k of ['myn_fwd_mode', 'myn_ret_mode']) {
    if (k in out && !['level', 'fixed', 'cat'].includes(out[k])) { warn(`${k} is not level/fixed/cat — using the global instead`); out[k] = CFG_REG[k].get(); }
  }
  // Rate rows must line up with the bounds that index them, or the Math.min
  // clamps in getMyntraComm / getMynColl / slabPick silently return a WRONG
  // band instead of failing. This runs last, after the bound fallbacks above,
  // so a row is always fitted to the bounds actually in force.
  const fit=(row,n)=>{
    if(!Array.isArray(row)) return row;   // scalars are legitimate flat fees
    const r=row.slice(0,n);
    while(r.length<n) r.push(r.length?r[r.length-1]:0);
    return r;
  };
  // Per-category bounds win over the global ones — but only when non-empty.
  // An empty array means "one fixed fee" for collection fees; for commission
  // getMyntraComm ignores it (`cb && cb.length`), so treating it as bounds
  // would truncate the row to a single rate and return the FIRST band's rate,
  // usually 0%, at every price.
  const boundsFor=(perCat,cat,gBounds)=>{
    const cb=perCat&&perCat[cat];
    return Array.isArray(cb)&&cb.length?cb:gBounds;
  };
  const fitMap=(key,gBounds,perCat,allowEmptyPerCat)=>{
    const map=out[key];
    if(!map||typeof map!=='object'||Array.isArray(map)) return;
    const fixed={};
    for(const[k,row]of Object.entries(map)){
      let want;
      if(allowEmptyPerCat&&perCat&&Array.isArray(perCat[k])) want=perCat[k].length+1; // [] ⇒ 1 fixed fee
      else want=boundsFor(perCat,k,gBounds).length+1;
      if(Array.isArray(row)&&row.length!==want) warn(`${key}["${k}"] has ${row.length} entries for ${want} bands — resized to fit`);
      fixed[k]=fit(row,want);
    }
    out[key]=fixed;
  };

  const commBounds=out.COMM_SLABS||CFG_REG.COMM_SLABS.get();
  fitMap('COMM_MYNTRA',commBounds,out.COMM_CAT_SLABS,false);
  if('COMM_SLAB_ONLY'in out) out.COMM_SLAB_ONLY=fit(out.COMM_SLAB_ONLY,commBounds.length+1);
  // COMM_SLAB_CAT carries its own bounds alongside its rates; drop the entry
  // rather than guess if the pair is malformed.
  if(out.COMM_SLAB_CAT&&typeof out.COMM_SLAB_CAT==='object'){
    const clean={};
    for(const[cat,o]of Object.entries(out.COMM_SLAB_CAT)){
      if(o&&Array.isArray(o.bounds)&&o.bounds.length&&Array.isArray(o.rates)&&o.rates.length){
        clean[cat]={bounds:o.bounds,rates:fit(o.rates,o.bounds.length+1)};
      } else warn(`COMM_SLAB_CAT["${cat}"] is malformed — that category falls back to the standard bands`);
    }
    out.COMM_SLAB_CAT=clean;
  }

  const gtBounds=out.GT_SLABS||CFG_REG.GT_SLABS.get();
  fitMap('GT_DATA',gtBounds,null,false);
  fitMap('GT_CAT_DATA',gtBounds,null,false);

  // Reverse fees are per-slab arrays only when REV_SLABS has bounds; with an
  // empty REV_SLABS they are flat scalars, which fit() passes through.
  const revBounds=out.REV_SLABS!==undefined?out.REV_SLABS:CFG_REG.REV_SLABS.get();
  if(Array.isArray(revBounds)&&revBounds.length){
    fitMap('REVERSE_FEES',revBounds,null,false);
    fitMap('REV_CAT_DATA',revBounds,null,false);
  }

  const collBounds=out.COLL_SLABS||CFG_REG.COLL_SLABS.get();
  fitMap('COLL_FEE_DATA',collBounds,out.COLL_CAT_SLABS,true);

  return out;
}

// ════════════════════════════════════════════════════════════
beforeEach(() => {
  _brandCfgCache = new Map();
  _calcCacheVersion++;
  _sanitizeBrandCfg._warned = new Set();
  brands = [];
});

describe('resolveBrandCfg — inheritance (the zero-diff contract)', () => {
  it('returns null for a brand with no config', () => {
    brands = [{ id: 'b1', config: null }];
    expect(resolveBrandCfg('b1')).toBeNull();
  });

  it('returns null for an empty config object', () => {
    brands = [{ id: 'b1', config: {} }];
    expect(resolveBrandCfg('b1')).toBeNull();
  });

  it('returns null for an unknown brand id and for no id at all', () => {
    expect(resolveBrandCfg('nope')).toBeNull();
    expect(resolveBrandCfg(null)).toBeNull();
    expect(resolveBrandCfg(undefined)).toBeNull();
  });

  it('ignores a non-object config rather than throwing', () => {
    brands = [{ id: 'b1', config: 'garbage' }];
    expect(resolveBrandCfg('b1')).toBeNull();
  });

  it('an unrecognised section name alone still resolves to null', () => {
    brands = [{ id: 'b1', config: { nonsense: { foo: 1 } } }];
    expect(resolveBrandCfg('b1')).toBeNull();
  });

  it('sections not overridden are absent from the result (so they inherit)', () => {
    brands = [{ id: 'b1', config: { fees: { amz_fba: 80 } } }];
    const r = resolveBrandCfg('b1');
    expect(r.amz_fba).toBe(80);
    expect(r.COMM_MYNTRA).toBeUndefined();
    expect(r.GT_DATA).toBeUndefined();
    expect(r.COLL_FEE_DATA).toBeUndefined();
  });
});

describe('resolveBrandCfg — section closure', () => {
  it('overriding one key pulls in every other key of that section', () => {
    // Otherwise a brand could take custom bounds while inheriting the rate
    // rows indexed by them, and the Math.min clamp would pick a wrong band.
    brands = [{ id: 'b1', config: { comm: { COMM_SLABS: [400, 900] } } }];
    const r = resolveBrandCfg('b1');
    for (const k of CFG_SECTIONS.comm) expect(r, `missing ${k}`).toHaveProperty(k);
    expect(r.COMM_SLABS).toEqual([400, 900]);
    expect(r.COMM_MODE).toBe('level_slab'); // inherited within the section
  });

  it('rate rows are resized to match the bounds that index them', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_SLABS: [400, 900], COMM_MYNTRA: { 'Kurta Sets': [5, 10, 15, 20, 25] } } } }];
    const r = resolveBrandCfg('b1');
    // 2 bounds ⇒ 3 bands; the 5-entry row is trimmed, not left to clamp.
    expect(r.COMM_MYNTRA['Kurta Sets']).toEqual([5, 10, 15]);
  });

  it('a short rate row is padded rather than reading undefined', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_SLABS: [300, 500, 1000, 2000], COMM_MYNTRA: { 'Sarees': [7, 9] } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.COMM_MYNTRA['Sarees']).toEqual([7, 9, 9, 9, 9]);
  });

  it('collection fees resize against per-category bounds when present', () => {
    brands = [{ id: 'b1', config: { coll: { COLL_CAT_SLABS: { 'Sarees': [250, 600] }, COLL_FEE_DATA: { 'Sarees': [4, 12, 30, 55, 70] } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.COLL_FEE_DATA['Sarees']).toEqual([4, 12, 30]); // 2 bounds ⇒ 3 fees
  });

  it('an empty per-category bounds array means one fixed fee', () => {
    brands = [{ id: 'b1', config: { coll: { COLL_CAT_SLABS: { 'Sarees': [] }, COLL_FEE_DATA: { 'Sarees': [33, 44] } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.COLL_CAT_SLABS['Sarees']).toEqual([]);
    expect(r.COLL_FEE_DATA['Sarees']).toEqual([33]);
  });
});

describe('resolveBrandCfg — per-key merge for category maps', () => {
  it('a category the brand did not customise still resolves from the global', () => {
    // Without this a category added later would silently fall through to the
    // hardcoded 18.88 / [15,17,...] defaults buried in the fee helpers.
    brands = [{ id: 'b1', config: { comm: { COMM_MYNTRA: { 'Kurta Sets': [1, 2, 3, 4, 5] } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.COMM_MYNTRA['Kurta Sets']).toEqual([1, 2, 3, 4, 5]);
    expect(r.COMM_MYNTRA['Sarees']).toEqual([0, 0, 23.6, 20.06, 22.42]); // inherited
  });

  it('level-keyed maps merge the same way', () => {
    brands = [{ id: 'b1', config: { ret: { REVERSE_FEES: { 'Level 2': 300 } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.REVERSE_FEES).toEqual({ 'Level 1': 167, 'Level 2': 300 });
  });

  it('the merge never mutates the global it merged from', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_AMAZON: { 'Sarees': 25 } } } }];
    resolveBrandCfg('b1');
    expect(COMM_AMAZON).toEqual({ 'Kurta Sets': 17, 'Sarees': 17 });
  });
});

describe('resolveBrandCfg — a corrupt config must never break pricing', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('falls back to the global for non-ascending slab bounds', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_SLABS: [900, 400] } } }];
    expect(resolveBrandCfg('b1').COMM_SLABS).toEqual([300, 500, 1000, 2000]);
  });

  it('falls back for slab bounds containing a non-number', () => {
    brands = [{ id: 'b1', config: { coll: { COLL_SLABS: [300, 'x', 700] } } }];
    expect(resolveBrandCfg('b1').COLL_SLABS).toEqual([300, 500, 700, 800, 1000, 2000]);
  });

  it('falls back for an empty slab list (would divide the world into one band)', () => {
    brands = [{ id: 'b1', config: { fwd: { GT_SLABS: [] } } }];
    expect(resolveBrandCfg('b1').GT_SLABS).toEqual([1, 99, 300, 500, 1000, 2000]);
  });

  it('accepts an empty REV_SLABS — that legitimately means one flat fee', () => {
    brands = [{ id: 'b1', config: { ret: { REV_SLABS: [] } } }];
    expect(resolveBrandCfg('b1').REV_SLABS).toEqual([]);
  });

  it('drops only the malformed category from per-category bounds', () => {
    brands = [{ id: 'b1', config: { coll: { COLL_CAT_SLABS: { good: [100, 200], bad: [200, 100] } } } }];
    expect(resolveBrandCfg('b1').COLL_CAT_SLABS).toEqual({ good: [100, 200] });
  });

  it('falls back for an invalid COMM_MODE', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_MODE: 'wat' } } }];
    expect(resolveBrandCfg('b1').COMM_MODE).toBe('level_slab');
  });

  it('falls back for a non-numeric or NaN fee', () => {
    brands = [{ id: 'b1', config: { fees: { amz_fba: 'free', myn_pg_fee: NaN, ajio_fwd: 88 } } }];
    const r = resolveBrandCfg('b1');
    expect(r.amz_fba).toBe(55);
    expect(r.myn_pg_fee).toBe(50.22);
    expect(r.ajio_fwd).toBe(88); // the valid one survives
  });

  it('falls back for an invalid fwd/ret mode', () => {
    brands = [{ id: 'b1', config: { fwd: { myn_fwd_mode: 'sideways' } } }];
    expect(resolveBrandCfg('b1').myn_fwd_mode).toBe('level');
  });

  it('ignores an array where a keyed map is expected', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_MYNTRA: [1, 2, 3] } } }];
    expect(resolveBrandCfg('b1').COMM_MYNTRA).toEqual(COMM_MYNTRA);
  });

  it('warns once per distinct problem, not once per lookup', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_MODE: 'wat' } } }];
    resolveBrandCfg('b1');
    _brandCfgCache = new Map();
    resolveBrandCfg('b1');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBrandCfg — every rate array is fitted to its bounds', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('an EMPTY per-category commission bound list does not truncate the row', () => {
    // getMyntraComm ignores an empty COMM_CAT_SLABS entry (`cb && cb.length`),
    // so treating [] as bounds would size the row to 1 and then return the
    // first band's rate — usually 0% — at every price.
    brands = [{ id: 'b1', config: { comm: { COMM_CAT_SLABS: { 'Sarees': [] }, COMM_MYNTRA: { 'Sarees': [1, 2, 3, 4, 5] } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.COMM_MYNTRA['Sarees']).toEqual([1, 2, 3, 4, 5]);
  });

  it('forward-shipping rows are fitted to the brand\'s own GT_SLABS', () => {
    // The gap that let a fanned-in category row keep the GLOBAL length and
    // return the wrong shipping band through slabPick's clamp.
    brands = [{ id: 'b1', config: { fwd: { GT_SLABS: [100, 500], GT_CAT_DATA: { 'Sarees': [1, 2, 3, 4, 5, 6, 7] } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.GT_CAT_DATA['Sarees']).toEqual([1, 2, 3]);   // 2 bounds ⇒ 3 bands
    expect(r.GT_DATA['Level 2']).toHaveLength(3);          // inherited row fitted too
  });

  it('slab-only commission rates are fitted to the commission bounds', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_SLABS: [400], COMM_SLAB_ONLY: [5, 6, 7, 8, 9] } } }];
    expect(resolveBrandCfg('b1').COMM_SLAB_ONLY).toEqual([5, 6]);
  });

  it('reverse fees stay flat scalars when REV_SLABS is empty', () => {
    brands = [{ id: 'b1', config: { ret: { REV_SLABS: [], REVERSE_FEES: { 'Level 2': 300 } } } }];
    expect(resolveBrandCfg('b1').REVERSE_FEES['Level 2']).toBe(300);
  });

  it('reverse fees become banded arrays when REV_SLABS has bounds', () => {
    brands = [{ id: 'b1', config: { ret: { REV_SLABS: [500, 1500], REVERSE_FEES: { 'Level 2': [10, 20, 30, 40] } } } }];
    expect(resolveBrandCfg('b1').REVERSE_FEES['Level 2']).toEqual([10, 20, 30]);
  });

  it('a malformed COMM_SLAB_CAT entry is dropped, not half-applied', () => {
    brands = [{ id: 'b1', config: { comm: { COMM_SLAB_CAT: {
      good: { bounds: [500], rates: [1, 2, 3, 4] }, bad: { bounds: [500] } } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.COMM_SLAB_CAT.good).toEqual({ bounds: [500], rates: [1, 2] });
    expect(r.COMM_SLAB_CAT.bad).toBeUndefined();
  });

  it('rows are fitted to the bounds actually in force after a bad-bounds fallback', () => {
    // The fallback replaces bad bounds with the global; the rates must then be
    // re-fitted to THOSE, or the invariant the check exists to protect breaks.
    brands = [{ id: 'b1', config: { comm: { COMM_SLABS: [900, 100], COMM_MYNTRA: { 'Sarees': [1, 2] } } } }];
    const r = resolveBrandCfg('b1');
    expect(r.COMM_SLABS).toEqual([300, 500, 1000, 2000]);
    expect(r.COMM_MYNTRA['Sarees']).toHaveLength(5);
  });
});

describe('resolveBrandCfg — memoization', () => {
  it('reuses the resolved object within a calc-cache version', () => {
    brands = [{ id: 'b1', config: { fees: { amz_fba: 80 } } }];
    expect(resolveBrandCfg('b1')).toBe(resolveBrandCfg('b1'));
  });

  it('rebuilds after the calc cache is invalidated', () => {
    brands = [{ id: 'b1', config: { fees: { amz_fba: 80 } } }];
    const first = resolveBrandCfg('b1');
    _calcCacheVersion++; _brandCfgCache = new Map();
    brands[0].config.fees.amz_fba = 90;
    const second = resolveBrandCfg('b1');
    expect(second).not.toBe(first);
    expect(second.amz_fba).toBe(90);
  });

  it('caches the null result too, so inheriting brands stay cheap', () => {
    brands = [{ id: 'b1', config: null }];
    expect(resolveBrandCfg('b1')).toBeNull();
    expect(_brandCfgCache.has('b1|' + _calcCacheVersion)).toBe(true);
  });
});
