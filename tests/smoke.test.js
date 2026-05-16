import { describe, it, expect } from 'vitest';

// Smoke test: proves the Vitest infrastructure runs.
// Real tests for calcSKU and friends will be added in follow-up PRs
// once we extract those functions into testable modules.

describe('test infrastructure', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
