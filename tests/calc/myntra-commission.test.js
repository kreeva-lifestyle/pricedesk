import { describe, it, expect } from 'vitest';

// SYNC NOTE: The fixtures and function below mirror index.html.
//   - COMM_SLABS:       index.html:2976 (editable slab bounds)
//   - _slabsFromBounds: index.html:2977
//   - SLABS:            index.html:2983 (derived from COMM_SLABS)
//   - COMM_MODE:        index.html:2986 ('level_slab' | 'slab')
//   - COMM_SLAB_ONLY:   index.html:2987 (slab-only mode rates)
//   - COMM_MYNTRA:      index.html:2993 (default values; user-editable
//                       from the Commission page at runtime)
//   - getMyntraComm:    index.html:3030
// If you change any of these in index.html, update this file too or
// these tests will silently pass while live behavior diverges.

let COMM_SLABS = [300, 500, 1000, 2000];
function _slabsFromBounds(bounds){
  const out=[];let prev=0;
  bounds.forEach(b=>{out.push({label:`${prev}–${b}`,min:prev,max:b});prev=b;});
  out.push({label:prev+'+',min:prev,max:Infinity});
  return out;
}
let SLABS = _slabsFromBounds(COMM_SLABS);

// Test-controlled fixtures (the real values are user-editable;
// tests must not depend on whatever happens to be saved in prod).
let COMM_MYNTRA;
let COMM_MODE = 'level_slab';
let COMM_SLAB_ONLY = [0, 0, 21.24, 17.70, 18.88];

function getMyntraComm(cat,sp){
  const slabs=COMM_MODE==='slab'?COMM_SLAB_ONLY:COMM_MYNTRA[cat];
  if(!slabs||!slabs.length)return 18.88;
  for(let i=0;i<SLABS.length;i++){
    if(sp>=SLABS[i].min&&sp<SLABS[i].max)return +slabs[Math.min(i,slabs.length-1)];
  }
  return +slabs[slabs.length-1];
}

describe('getMyntraComm — commission rate by category and seller price', () => {
  describe('unknown category', () => {
    it('returns the 18.88% fallback when category is missing', () => {
      COMM_MYNTRA = { Kurtas: [0, 0, 21.24, 17.70, 18.88] };
      expect(getMyntraComm('NonExistentCategory', 1500)).toBe(18.88);
    });

    it('returns the fallback even for sp = 0', () => {
      COMM_MYNTRA = {};
      expect(getMyntraComm('Anything', 0)).toBe(18.88);
    });
  });

  describe('Kurta Sets — slab boundaries (rates [0, 0, 21.24, 17.70, 18.88])', () => {
    const kurtaSets = [0, 0, 21.24, 17.70, 18.88];

    it('sp = 0 falls in slab 0 (0–300) → 0%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 0)).toBe(0);
    });

    it('sp = 299 falls in slab 0 (0–300) → 0%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 299)).toBe(0);
    });

    it('sp = 300 falls in slab 1 (300–500) → 0%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 300)).toBe(0);
    });

    it('sp = 499 falls in slab 1 (300–500) → 0%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 499)).toBe(0);
    });

    it('sp = 500 falls in slab 2 (500–1000) → 21.24%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 500)).toBe(21.24);
    });

    it('sp = 999 falls in slab 2 (500–1000) → 21.24%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 999)).toBe(21.24);
    });

    it('sp = 1000 falls in slab 3 (1000–2000) → 17.70%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 1000)).toBe(17.70);
    });

    it('sp = 1999 falls in slab 3 (1000–2000) → 17.70%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 1999)).toBe(17.70);
    });

    it('sp = 2000 falls in slab 4 (2000+) → 18.88%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 2000)).toBe(18.88);
    });

    it('sp = 999999 falls in slab 4 (2000+) → 18.88%', () => {
      COMM_MYNTRA = { 'Kurta Sets': kurtaSets };
      expect(getMyntraComm('Kurta Sets', 999999)).toBe(18.88);
    });
  });

  describe('Tops — different slab values exercise the lookup', () => {
    // Rates [0, 0, 22.42, 21.24, 18.88]
    const tops = [0, 0, 22.42, 21.24, 18.88];

    it('sp = 750 returns 22.42 (slab 2)', () => {
      COMM_MYNTRA = { Tops: tops };
      expect(getMyntraComm('Tops', 750)).toBe(22.42);
    });

    it('sp = 1500 returns 21.24 (slab 3)', () => {
      COMM_MYNTRA = { Tops: tops };
      expect(getMyntraComm('Tops', 1500)).toBe(21.24);
    });

    it('sp = 3000 returns 18.88 (slab 4)', () => {
      COMM_MYNTRA = { Tops: tops };
      expect(getMyntraComm('Tops', 3000)).toBe(18.88);
    });
  });

  describe('out-of-range inputs', () => {
    // Documents current behavior so a future refactor doesn't change
    // it accidentally. SLABS start at min=0 so any negative sp matches
    // no slab; the function falls through to the last-slab fallback.
    it('sp = -100 falls through to last slab rate (current behavior)', () => {
      COMM_MYNTRA = { Tops: [0, 0, 22.42, 21.24, 18.88] };
      expect(getMyntraComm('Tops', -100)).toBe(18.88);
    });
  });

  describe('slab-only mode (COMM_MODE = "slab")', () => {
    it('ignores the category and uses COMM_SLAB_ONLY rates', () => {
      COMM_MODE = 'slab';
      COMM_SLAB_ONLY = [1, 2, 3, 4, 5];
      COMM_MYNTRA = { Tops: [9, 9, 9, 9, 9] };
      expect(getMyntraComm('Tops', 350)).toBe(2);
      expect(getMyntraComm('UnknownCategory', 350)).toBe(2);
      expect(getMyntraComm('Tops', 5000)).toBe(5);
      COMM_MODE = 'level_slab';
    });

    it('short rate arrays clamp to their last entry', () => {
      COMM_MODE = 'slab';
      COMM_SLAB_ONLY = [10, 20];
      expect(getMyntraComm('Any', 5000)).toBe(20);
      COMM_MODE = 'level_slab';
    });
  });

  describe('editable slab bounds', () => {
    it('derived SLABS follows changed COMM_SLABS bounds', () => {
      const saved = { COMM_SLABS, SLABS };
      COMM_SLABS = [500, 1500];
      SLABS = _slabsFromBounds(COMM_SLABS);
      COMM_MYNTRA = { Tops: [10, 20, 30] };
      expect(SLABS.map(s => s.label)).toEqual(['0–500', '500–1500', '1500+']);
      expect(getMyntraComm('Tops', 450)).toBe(10);
      expect(getMyntraComm('Tops', 900)).toBe(20);
      expect(getMyntraComm('Tops', 5000)).toBe(30);
      COMM_SLABS = saved.COMM_SLABS; SLABS = saved.SLABS;
    });
  });
});
