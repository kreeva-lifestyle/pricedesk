import { describe, it, expect } from 'vitest';

// SYNC NOTE: The fixtures and function below mirror index.html.
//   - SLABS:          index.html:2910
//   - COMM_MYNTRA:    index.html:2915 (default values; user-editable
//                     from the Commission page at runtime)
//   - getMyntraComm:  index.html:2953
// If you change any of these in index.html, update this file too or
// these tests will silently pass while live behavior diverges.

const SLABS = [
  { label: '0–300',    min: 0,    max: 300 },
  { label: '300–500',  min: 300,  max: 500 },
  { label: '500–1000', min: 500,  max: 1000 },
  { label: '1000–2000',min: 1000, max: 2000 },
  { label: '2000+',    min: 2000, max: Infinity },
];

// Test-controlled fixture (the real COMM_MYNTRA is user-editable;
// tests must not depend on whatever happens to be saved in prod).
let COMM_MYNTRA;

function getMyntraComm(cat, sp) {
  const slabs = COMM_MYNTRA[cat];
  if (!slabs) return 18.88;
  for (let i = 0; i < SLABS.length; i++) {
    if (sp >= SLABS[i].min && sp < SLABS[i].max) return slabs[i];
  }
  return slabs[slabs.length - 1];
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
});
