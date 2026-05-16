import { describe, it, expect } from 'vitest';

// SYNC NOTE: The function below is copied verbatim from
// index.html line 2951. If you change `autoGST` in index.html,
// update this copy and the tests too, or these tests will silently
// pass while the live behavior diverges.
//
// Future PR: extract this into src/calc/gst.js and have both
// index.html and these tests import the same source.

function autoGST(sp) {
  return sp >= 2500 ? 0.18 : 0.05;
}

describe('autoGST — GST rate from seller price', () => {
  describe('below the ₹2,500 threshold → 5%', () => {
    it('returns 0.05 for sp = 0', () => {
      expect(autoGST(0)).toBe(0.05);
    });

    it('returns 0.05 for sp = 1', () => {
      expect(autoGST(1)).toBe(0.05);
    });

    it('returns 0.05 for sp = 2499 (just under the boundary)', () => {
      expect(autoGST(2499)).toBe(0.05);
    });

    it('returns 0.05 for sp = 2499.99 (fractional, just under)', () => {
      expect(autoGST(2499.99)).toBe(0.05);
    });
  });

  describe('at or above ₹2,500 threshold → 18%', () => {
    it('returns 0.18 for sp = 2500 (boundary is inclusive)', () => {
      expect(autoGST(2500)).toBe(0.18);
    });

    it('returns 0.18 for sp = 2500.01 (just over)', () => {
      expect(autoGST(2500.01)).toBe(0.18);
    });

    it('returns 0.18 for sp = 5000', () => {
      expect(autoGST(5000)).toBe(0.18);
    });

    it('returns 0.18 for sp = 99999', () => {
      expect(autoGST(99999)).toBe(0.18);
    });
  });

  describe('edge cases', () => {
    it('returns 0.05 for negative sp (treats as below threshold)', () => {
      expect(autoGST(-100)).toBe(0.05);
    });
  });
});
