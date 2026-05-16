import { describe, it, expect } from 'vitest';
import { autoGST } from '../../src/calc/gst.js';

// Imports the real production source — no copy, no drift. This is the
// first function migrated as part of Phase 4B (module extraction).

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
