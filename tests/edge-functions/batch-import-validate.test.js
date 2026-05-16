import { describe, it, expect } from 'vitest';
import { validateSku, validateBatch } from '../../supabase/functions/batch-import/validate.ts';

// Tests for the batch-import Edge Function's input validation.
// These exercise the pure validation logic — they do NOT call
// Supabase or run the Deno serve handler.

describe('validateSku — single-row validation', () => {
  it('accepts a minimal valid row (id only) and fills in defaults', () => {
    const { row, errors } = validateSku({ id: 'sku-1' }, 0);
    expect(errors).toEqual([]);
    expect(row).toMatchObject({
      id: 'sku-1',
      sku: null, style_id: null, brand_id: null, category: null,
      level: 'Level 2',
      cost: 0, markup: 0, discount: 0,
      ignore_threshold: false, archived: false,
      tags: [], note: '',
    });
    expect(typeof row.updated_at).toBe('string');
  });

  it('preserves all valid fields', () => {
    const input = {
      id: 'sku-2', sku: 'MYNK-001', style_id: '1234',
      brand_id: 'b-1', category: 'Kurtas', level: 'Level 3',
      cost: 500, markup: 75, discount: 30,
      ignore_threshold: true, archived: false,
      tags: ['urgent', 'restock'], note: 'imported from spreadsheet',
      updated_at: '2026-05-16T00:00:00Z',
    };
    const { row, errors } = validateSku(input, 0);
    expect(errors).toEqual([]);
    expect(row).toEqual(input);
  });

  describe('rejects non-objects', () => {
    it.each([
      ['null',      null],
      ['string',    'sku-1'],
      ['number',    42],
      ['array',     ['sku-1']],
      ['boolean',   true],
    ])('rejects %s', (_label, value) => {
      const { row, errors } = validateSku(value, 3);
      expect(row).toBe(null);
      expect(errors).toHaveLength(1);
      expect(errors[0].index).toBe(3);
      expect(errors[0].message).toContain('object');
    });
  });

  describe('id requirements', () => {
    it('rejects missing id', () => {
      const { row, errors } = validateSku({}, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'id')).toBe(true);
    });

    it('rejects empty-string id', () => {
      const { row, errors } = validateSku({ id: '' }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'id')).toBe(true);
    });

    it('rejects non-string id', () => {
      const { row, errors } = validateSku({ id: 123 }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'id')).toBe(true);
    });

    it('rejects id longer than 200 chars', () => {
      const { row, errors } = validateSku({ id: 'x'.repeat(201) }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'id' && e.message.includes('200'))).toBe(true);
    });

    it('accepts id of exactly 200 chars', () => {
      const { row, errors } = validateSku({ id: 'x'.repeat(200) }, 0);
      expect(row).not.toBe(null);
      expect(errors).toEqual([]);
    });
  });

  describe('string fields', () => {
    it.each(['sku', 'style_id', 'brand_id', 'category', 'note'])(
      '%s rejects non-string when provided',
      (field) => {
        const { row, errors } = validateSku({ id: 'sku-1', [field]: 42 }, 0);
        expect(row).toBe(null);
        expect(errors.some(e => e.field === field)).toBe(true);
      }
    );

    it.each(['sku', 'style_id', 'brand_id', 'category', 'note'])(
      '%s accepts null',
      (field) => {
        const { row, errors } = validateSku({ id: 'sku-1', [field]: null }, 0);
        expect(errors).toEqual([]);
        expect(row).not.toBe(null);
      }
    );
  });

  describe('level', () => {
    it.each(['Level 1', 'Level 2', 'Level 3', 'Level 4'])(
      'accepts "%s"',
      (lvl) => {
        const { row, errors } = validateSku({ id: 'sku-1', level: lvl }, 0);
        expect(errors).toEqual([]);
        expect(row.level).toBe(lvl);
      }
    );

    it('rejects unknown level', () => {
      const { row, errors } = validateSku({ id: 'sku-1', level: 'Level 999' }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'level')).toBe(true);
    });

    it('rejects non-string level', () => {
      const { row, errors } = validateSku({ id: 'sku-1', level: 2 }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'level')).toBe(true);
    });
  });

  describe('numeric fields', () => {
    it.each(['cost', 'markup', 'discount'])('%s rejects negative', (field) => {
      const { row, errors } = validateSku({ id: 'sku-1', [field]: -1 }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === field)).toBe(true);
    });

    it.each(['cost', 'markup', 'discount'])('%s rejects NaN', (field) => {
      const { row, errors } = validateSku({ id: 'sku-1', [field]: NaN }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === field)).toBe(true);
    });

    it.each(['cost', 'markup', 'discount'])('%s rejects Infinity', (field) => {
      const { row, errors } = validateSku({ id: 'sku-1', [field]: Infinity }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === field)).toBe(true);
    });

    it.each(['cost', 'markup', 'discount'])('%s rejects string', (field) => {
      const { row, errors } = validateSku({ id: 'sku-1', [field]: '100' }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === field)).toBe(true);
    });

    it('accepts 0 for all numeric fields', () => {
      const { row, errors } = validateSku({ id: 'sku-1', cost: 0, markup: 0, discount: 0 }, 0);
      expect(errors).toEqual([]);
      expect(row.cost).toBe(0);
    });
  });

  describe('boolean fields', () => {
    it.each(['ignore_threshold', 'archived'])('%s rejects non-boolean', (field) => {
      const { row, errors } = validateSku({ id: 'sku-1', [field]: 'true' }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === field)).toBe(true);
    });
  });

  describe('tags', () => {
    it('rejects non-array tags', () => {
      const { row, errors } = validateSku({ id: 'sku-1', tags: 'urgent' }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'tags')).toBe(true);
    });

    it('rejects array with non-string elements', () => {
      const { row, errors } = validateSku({ id: 'sku-1', tags: ['ok', 42] }, 0);
      expect(row).toBe(null);
      expect(errors.some(e => e.field === 'tags')).toBe(true);
    });

    it('accepts empty array', () => {
      const { row, errors } = validateSku({ id: 'sku-1', tags: [] }, 0);
      expect(errors).toEqual([]);
      expect(row.tags).toEqual([]);
    });
  });

  it('collects multiple errors at once', () => {
    const { row, errors } = validateSku({
      id: '',                  // empty
      cost: -5,                // negative
      level: 'Level 99',       // unknown
      tags: 'no',              // not array
    }, 7);
    expect(row).toBe(null);
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.every(e => e.index === 7)).toBe(true);
  });
});

describe('validateBatch — batch validation', () => {
  it('accepts a valid batch and returns all normalized rows', () => {
    const result = validateBatch({
      skus: [
        { id: 'sku-1', cost: 100 },
        { id: 'sku-2', cost: 200, level: 'Level 3' },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].id).toBe('sku-1');
    expect(result.rows[1].level).toBe('Level 3');
  });

  describe('top-level body shape', () => {
    it('rejects null', () => {
      const r = validateBatch(null);
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toContain('object');
    });

    it('rejects array as body', () => {
      const r = validateBatch([]);
      expect(r.valid).toBe(false);
    });

    it('rejects string as body', () => {
      const r = validateBatch('hi');
      expect(r.valid).toBe(false);
    });

    it('rejects missing skus key', () => {
      const r = validateBatch({});
      expect(r.valid).toBe(false);
      expect(r.errors[0].field).toBe('skus');
    });

    it('rejects skus that is not an array', () => {
      const r = validateBatch({ skus: 'sku-1' });
      expect(r.valid).toBe(false);
      expect(r.errors[0].field).toBe('skus');
    });

    it('rejects empty skus array', () => {
      const r = validateBatch({ skus: [] });
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toContain('at least one');
    });

    it('rejects > 10,000 rows', () => {
      const huge = Array.from({ length: 10_001 }, (_, i) => ({ id: `sku-${i}` }));
      const r = validateBatch({ skus: huge });
      expect(r.valid).toBe(false);
      expect(r.errors[0].message).toContain('10000');
    });

    it('accepts exactly 10,000 rows', () => {
      const max = Array.from({ length: 10_000 }, (_, i) => ({ id: `sku-${i}` }));
      const r = validateBatch({ skus: max });
      expect(r.valid).toBe(true);
      expect(r.rows).toHaveLength(10_000);
    });
  });

  describe('duplicate detection', () => {
    it('rejects two rows with the same id', () => {
      const r = validateBatch({
        skus: [
          { id: 'dup' },
          { id: 'other' },
          { id: 'dup' },
        ],
      });
      expect(r.valid).toBe(false);
      const dupErr = r.errors.find(e => e.field === 'id' && e.message.includes('Duplicate'));
      expect(dupErr).toBeDefined();
      expect(dupErr.index).toBe(2);
    });

    it('allows different ids', () => {
      const r = validateBatch({
        skus: [
          { id: 'a' }, { id: 'b' }, { id: 'c' },
        ],
      });
      expect(r.valid).toBe(true);
    });
  });

  it('aggregates errors across all rows', () => {
    const r = validateBatch({
      skus: [
        { id: 'good' },
        { id: '' },           // invalid id
        { id: 'x', cost: -1 },// invalid cost
      ],
    });
    expect(r.valid).toBe(false);
    // 'good' is valid → 1 row collected
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].id).toBe('good');
    // Errors from indexes 1 and 2
    expect(r.errors.some(e => e.index === 1)).toBe(true);
    expect(r.errors.some(e => e.index === 2)).toBe(true);
  });
});
