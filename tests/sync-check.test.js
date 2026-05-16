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
        'function getMynRet(level){return REVERSE_FEES[level]||218;}'
      );
    });
  });

  describe('inline lookup tables', () => {
    it('SLABS is unchanged (tests/calc/myntra-commission.test.js)', () => {
      expect(HTML).toContain(
        "const SLABS=[{label:'0–300',min:0,max:300},{label:'300–500',min:300,max:500},{label:'500–1000',min:500,max:1000},{label:'1000–2000',min:1000,max:2000},{label:'2000+',min:2000,max:Infinity}];"
      );
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
        "const blocked = /[;{}\\[\\]\\\\]|(\\b(eval|Function|constructor|prototype|__proto__|import|require|fetch|XMLHttpRequest|document|window|alert|prompt|confirm|setTimeout|setInterval|setImmediate)\\b)/;"
      );
    });
  });
});
