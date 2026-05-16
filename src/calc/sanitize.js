// Sanitizer for user-edited wireframe formula expressions.
//
// The wireframe page lets a logged-in user edit JS-like math expressions
// that ultimately get evaluated with `new Function(...)` inside runWFEngine.
// That's an inherent risk — `new Function` can execute arbitrary code.
// This sanitizer is a denylist gate in front of `new Function`: if the
// expression contains any blocked token, the engine substitutes the
// literal string `'0'` instead, so the row evaluates to 0 with a console
// warning.
//
// The denylist is conservative: any JS keyword that isn't needed for
// arithmetic. The proper long-term fix is to replace `new Function` with
// a real expression parser (e.g., mathjs) — see issue #4 in the audit.
//
// Imported by tests/calc/wf-engine.test.js and by index.html (via the
// module shim near the top of <body>, which assigns to window.sanitizeExpr).

const BLOCKED = /[;{}\[\]\\`]|(\b(eval|Function|constructor|prototype|__proto__|import|require|fetch|XMLHttpRequest|document|window|globalThis|self|alert|prompt|confirm|setTimeout|setInterval|setImmediate|arguments|await|async|new|class|function|this|delete|void|typeof|instanceof|with|debugger|yield|throw|try|catch|finally)\b)/;

export function sanitizeExpr(expr) {
  if (!expr) return '0';
  if (BLOCKED.test(expr)) {
    console.warn('Blocked unsafe expression:', expr);
    return '0';
  }
  return expr;
}
