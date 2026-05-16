import { describe, it, expect, vi } from 'vitest';
import { autoGST } from '../../src/calc/gst.js';
import { sanitizeExpr } from '../../src/calc/sanitize.js';

// SYNC NOTE: runWFEngine is still copied verbatim from index.html:6728.
// autoGST and sanitizeExpr are now imported from their src/ modules.
//
// We deliberately do NOT copy WF.myntra or the calcMyntraFull
// wrapper. Those depend on user-editable wireframe rules and
// expected outputs would change every time the user edits a
// formula. Instead, these tests exercise the engine's mechanics
// with small synthetic rule sets so we catch regressions in the
// engine itself, not in user-specific formulas.

// sanitizeExpr imported from real source at top of file (Phase 4B extraction).

// Minimal stand-ins for the globals runWFEngine reaches for.
const CATS = ['Kurta Sets', 'Tops'];
const REVERSE_FEES = { 'Level 1': 167, 'Level 2': 218, 'Level 3': 259, 'Level 4': 331 };
const LOGISTICS_SETTINGS = { myn_pg_fee: 50.22 };
function getMynFwd() { return 0; }
function getMynRet(lvl) { return REVERSE_FEES[lvl] ?? 218; }
function getMyntraComm() { return 0; }

// WF lookup table — keyed by `fn` field on lookup rows. The engine
// invokes WF_LOOKUPS[row.fn](ctx). Tests stub specific lookups.
let WF_LOOKUPS = {};

// WF is the per-marketplace rule list. Tests assign WF.myntra etc.
let WF = {};

// SYNC NOTE: runWFEngine fix in this PR — line 6776 now coerces NaN to null.
function runWFEngine(marketplace, inputs) {
  const rows = WF[marketplace] || [];
  const ctx = {
    ...inputs,
    _mp: marketplace,
    getMynFwd: (lvl, sp) => getMynFwd(lvl || inputs.level || 'Level 2', sp),
    getMynRet: (lvl) => getMynRet(lvl || inputs.level || 'Level 2'),
    getMyntraComm: (cat, sp) => getMyntraComm(cat || inputs.cat || (CATS[0] || 'Kurta Sets'), sp),
    autoGST: autoGST,
    REVERSE_FEES, LOGISTICS_SETTINGS, Math,
    level: inputs.level || 'Level 2',
    cat: inputs.cat || (CATS[0] || 'Kurta Sets'),
  };

  for (const row of rows) {
    if (!row.var) continue;

    if (row.t === 'lookup') {
      try {
        ctx[row.var] = WF_LOOKUPS[row.fn] ? WF_LOOKUPS[row.fn](ctx) : null;
      } catch (e) {
        ctx[row.var] = null;
        console.warn('WF lookup error:', row.fn, e.message);
      }
      continue;
    }

    if (row.t === 'input') {
      if (ctx[row.var] === undefined || ctx[row.var] === null) {
        ctx[row.var] = row.defaultVal !== undefined ? row.defaultVal : 0;
      }
      continue;
    }

    if (!row.expr) continue;
    try {
      const validIdRe = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
      const entries = Object.entries(ctx).filter(([k]) => validIdRe.test(k));
      const keys = entries.map(([k]) => k);
      const vals = entries.map(([, v]) => v);
      const fn = new Function(...keys, `"use strict"; return (${sanitizeExpr(row.expr)});`);
      const r = fn(...vals);
      ctx[row.var] = (typeof r === 'number' && isNaN(r)) || r == null ? null : r;
    } catch (e) {
      ctx[row.var] = null;
      console.warn(`WF expr error [${row.var}]: ${row.expr}`, e.message);
    }
  }
  return ctx;
}

// ════════════════════════════════════════════════════════════
describe('sanitizeExpr — blocks unsafe formula content', () => {
  describe('safe expressions pass through unchanged', () => {
    it('returns a simple arithmetic expression', () => {
      expect(sanitizeExpr('cost + markup')).toBe('cost + markup');
    });
    it('returns an expression with Math.* calls', () => {
      expect(sanitizeExpr('Math.round(mrp * 1.18)')).toBe('Math.round(mrp * 1.18)');
    });
    it('returns an expression with parentheses and decimals', () => {
      expect(sanitizeExpr('(sp - cost) * 0.18')).toBe('(sp - cost) * 0.18');
    });
    it('returns a ternary expression', () => {
      expect(sanitizeExpr('sp > 2500 ? 0.18 : 0.05')).toBe('sp > 2500 ? 0.18 : 0.05');
    });
  });

  describe('falsy input → "0"', () => {
    it('empty string → "0"', () => expect(sanitizeExpr('')).toBe('0'));
    it('null → "0"',          () => expect(sanitizeExpr(null)).toBe('0'));
    it('undefined → "0"',     () => expect(sanitizeExpr(undefined)).toBe('0'));
  });

  describe('blocks dangerous tokens by replacing with "0"', () => {
    // suppress the console.warn calls so they don't clutter test output
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    it.each([
      ['eval call',           'eval("alert(1)")'],
      ['Function constructor','Function("return 1")()'],
      ['__proto__ access',    'x.__proto__.toString'],
      ['constructor access',  'x.constructor("alert")'],
      ['prototype access',    'Array.prototype.slice'],
      ['import',              'import("./mod.js")'],
      ['require',             'require("fs")'],
      ['fetch',               'fetch("/admin/data")'],
      ['XMLHttpRequest',      'new XMLHttpRequest()'],
      ['document',            'document.cookie'],
      ['window',              'window.location'],
      ['alert',               'alert("xss")'],
      ['prompt',              'prompt()'],
      ['confirm',             'confirm()'],
      ['setTimeout',          'setTimeout(()=>0, 1)'],
      ['setInterval',         'setInterval(()=>0, 1)'],
      ['setImmediate',        'setImmediate(()=>0)'],
      ['semicolon',           'a; b'],
      ['braces',              '{a:1}'],
      ['brackets',            'a[0]'],
      ['backslash',           'a\\b'],
      ['backtick',            'a`b`'],
      ['globalThis',          'globalThis.fetch("/x")'],
      ['self',                'self.location'],
      ['arguments',           'arguments[0]'],
      ['await',               'await foo'],
      ['async',               'async()=>0'],
      ['new',                 'new Function("x")'],
      ['class',               'class X {}'],
      ['function keyword',    'function(){}'],
      ['this',                'this.constructor'],
      ['delete',              'delete a.b'],
      ['void',                'void 0'],
      ['typeof',              'typeof a'],
      ['instanceof',          'a instanceof Object'],
      ['with',                'with(a) b'],
      ['debugger',            'debugger'],
      ['yield',               'yield foo'],
      ['throw',               'throw 1'],
      ['try',                 'try foo'],
      ['catch',               'catch(e) e'],
      ['finally',             'finally bar'],
    ])('blocks %s', (_label, expr) => {
      expect(sanitizeExpr(expr)).toBe('0');
    });

    spy.mockRestore();
  });
});

// ════════════════════════════════════════════════════════════
describe('runWFEngine — row sequencing and evaluation mechanics', () => {
  it('evaluates expression rows in order, downstream rows see upstream values', () => {
    WF = {
      test: [
        { var: 'cost',   t: 'input', defaultVal: 100 },
        { var: 'markup', t: 'input', defaultVal: 50 },
        { var: 'mrp',    expr: 'cost * (1 + markup / 100)' },
        { var: 'sp',     expr: 'mrp * 3' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.mrp).toBe(150);
    expect(r.sp).toBe(450);
  });

  it('input row uses inputs over defaultVal when provided', () => {
    WF = {
      test: [
        { var: 'cost', t: 'input', defaultVal: 100 },
        { var: 'doubled', expr: 'cost * 2' },
      ],
    };
    const r = runWFEngine('test', { cost: 500 });
    expect(r.doubled).toBe(1000);
  });

  it('input row falls back to defaultVal when input is missing', () => {
    WF = {
      test: [
        { var: 'cost', t: 'input', defaultVal: 999 },
        { var: 'echo', expr: 'cost' },
      ],
    };
    const r = runWFEngine('test', {});
    expect(r.echo).toBe(999);
  });

  it('lookup row calls WF_LOOKUPS[row.fn] with the current context', () => {
    let receivedCtx = null;
    WF = {
      test: [
        { var: 'fromLookup', t: 'lookup', fn: 'myLookup' },
      ],
    };
    WF_LOOKUPS = {
      myLookup: (ctx) => { receivedCtx = ctx; return 42; },
    };
    const r = runWFEngine('test', { extra: 'hello' });
    expect(r.fromLookup).toBe(42);
    expect(receivedCtx.extra).toBe('hello');
  });

  it('lookup with unknown fn → null', () => {
    WF = { test: [{ var: 'x', t: 'lookup', fn: 'nope' }] };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.x).toBe(null);
  });

  it('lookup that throws → null, engine continues', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    WF = {
      test: [
        { var: 'bad', t: 'lookup', fn: 'thrower' },
        { var: 'good', expr: '1 + 1' },
      ],
    };
    WF_LOOKUPS = { thrower: () => { throw new Error('boom'); } };
    const r = runWFEngine('test', {});
    expect(r.bad).toBe(null);
    expect(r.good).toBe(2);
    spy.mockRestore();
  });

  it('expression that returns NaN is coerced to null so downstream `??` fallbacks fire', () => {
    WF = {
      test: [
        { var: 'x', expr: '0 / 0' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.x).toBe(null);
  });

  it('NaN coercion lets downstream rows fall back via ??', () => {
    // A row whose expression goes NaN should not poison the chain.
    // After coercion the next row can guard with `?? fallback`.
    WF = {
      test: [
        { var: 'broken', expr: '0 / 0' },
        { var: 'safe',   expr: '(broken ?? 99) + 1' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.broken).toBe(null);
    expect(r.safe).toBe(100);
  });

  it('expression that throws → null, engine continues with subsequent rows', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    WF = {
      test: [
        { var: 'broken', expr: 'thisIdentifierDoesNotExist' },
        { var: 'still',  expr: '7 * 6' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.broken).toBe(null);
    expect(r.still).toBe(42);
    spy.mockRestore();
  });

  it('rows without a `var` are skipped entirely', () => {
    WF = {
      test: [
        { var: '',  expr: '999' },  // skipped — no var
        { var: 'x', expr: '1 + 1' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.x).toBe(2);
  });

  it('unsafe expressions are sanitized to "0" before evaluation', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    WF = {
      test: [
        { var: 'evil', expr: 'eval("9999")' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.evil).toBe(0);
    spy.mockRestore();
  });

  it('context exposes helper functions (callable from formulas)', () => {
    WF = {
      test: [
        { var: 'gstRate', expr: 'autoGST(custPaid)' },
        { var: 'fwdFee',  expr: 'getMynFwd(level, custPaid)' },
        { var: 'retFee',  expr: 'getMynRet(level)' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', { custPaid: 3000, level: 'Level 3' });
    expect(r.gstRate).toBe(0.18);
    expect(r.fwdFee).toBe(0);   // our test stub returns 0
    expect(r.retFee).toBe(259); // REVERSE_FEES['Level 3']
  });

  it('bracket-notation access to constants is blocked by sanitizeExpr → expression becomes "0"', () => {
    // Formulas cannot use REVERSE_FEES["Level 3"]-style access because
    // `[` and `]` are blocked by sanitizeExpr. The exposed helper
    // functions (getMynRet, getMyntraComm, getMynFwd) are the
    // intended way for formulas to look these values up.
    WF = {
      test: [
        { var: 'attempted', expr: 'REVERSE_FEES["Level 3"]' },
      ],
    };
    WF_LOOKUPS = {};
    const r = runWFEngine('test', {});
    expect(r.attempted).toBe(0);
  });

  it('marketplace with no defined rules → context contains only inputs and built-ins', () => {
    WF = {};
    WF_LOOKUPS = {};
    const r = runWFEngine('myntra', { cost: 100 });
    expect(r.cost).toBe(100);
    expect(r._mp).toBe('myntra');
    expect(typeof r.autoGST).toBe('function');
  });
});
