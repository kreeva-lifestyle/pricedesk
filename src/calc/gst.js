// GST rate lookup for a Customer Paid amount.
//
// Indian e-commerce GST tiers (as configured for this app):
//   Customer Paid < ₹2,500  → 5%
//   Customer Paid ≥ ₹2,500  → 18%
//
// The boundary is inclusive on the 18% side: 2500 itself rounds up.
//
// Imported by tests/calc/gst.test.js and by index.html (via the module
// shim near the top of <body>, which assigns to window.autoGST for the
// classic-script callers in index.html). This is the single source of
// truth — there is no longer a duplicate copy in the test file.

export function autoGST(sp) {
  return sp >= 2500 ? 0.18 : 0.05;
}
