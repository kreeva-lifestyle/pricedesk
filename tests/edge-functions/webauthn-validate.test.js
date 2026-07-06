import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_TTL_MS,
  ORIGIN_RP,
  rpIdForOrigin,
  takeChallenge,
  sanitizePasskey,
  passkeysForRp,
  passkeysForUser,
  isWebAuthnResponse,
  cleanDeviceName,
} from '../../supabase/functions/webauthn/validate.ts';

// Tests for the webauthn Edge Function's pure helpers.
// These exercise challenge lifecycle, origin→rpId mapping and
// credential shaping — they do NOT call Supabase or WebAuthn crypto.

describe('rpIdForOrigin — origin allowlist → RP ID', () => {
  it('maps the production domain to itself', () => {
    expect(rpIdForOrigin('https://pricing.aryadesigns.co.in')).toBe('pricing.aryadesigns.co.in');
  });

  it('maps the GitHub Pages origin to its own rpId', () => {
    expect(rpIdForOrigin('https://kreeva-lifestyle.github.io')).toBe('kreeva-lifestyle.github.io');
  });

  it('maps localhost dev ports to "localhost"', () => {
    expect(rpIdForOrigin('http://localhost:5173')).toBe('localhost');
    expect(rpIdForOrigin('http://localhost:4173')).toBe('localhost');
  });

  it('rejects unknown origins and null', () => {
    expect(rpIdForOrigin('https://evil.example.com')).toBeNull();
    expect(rpIdForOrigin(null)).toBeNull();
    expect(rpIdForOrigin('')).toBeNull();
  });

  it('every allowlisted rpId is a registrable suffix of its origin host', () => {
    for (const [origin, rpId] of Object.entries(ORIGIN_RP)) {
      const host = new URL(origin).hostname;
      expect(host === rpId || host.endsWith('.' + rpId)).toBe(true);
    }
  });
});

describe('takeChallenge — one-time challenge with TTL', () => {
  it('returns and consumes a live challenge', () => {
    const now = 1_000_000;
    const map = { abc: { userId: 'u1', exp: now + 1000 } };
    const rec = takeChallenge(map, 'abc', now);
    expect(rec).toEqual({ userId: 'u1', exp: now + 1000 });
    expect(map.abc).toBeUndefined();
  });

  it('a challenge can only be used once (replay protection)', () => {
    const now = 1_000_000;
    const map = { abc: { exp: now + 1000 } };
    expect(takeChallenge(map, 'abc', now)).not.toBeNull();
    expect(takeChallenge(map, 'abc', now)).toBeNull();
  });

  it('expired challenges are pruned and unusable', () => {
    const now = 1_000_000;
    const map = {
      stale: { userId: 'u1', exp: now - 1 },
      live: { userId: 'u2', exp: now + 1 },
    };
    expect(takeChallenge(map, 'stale', now)).toBeNull();
    expect(map.stale).toBeUndefined();  // pruned
    expect(map.live).toBeDefined();     // untouched
  });

  it('unknown challenge returns null', () => {
    expect(takeChallenge({}, 'nope', 0)).toBeNull();
  });

  it('TTL constant is 5 minutes', () => {
    expect(CHALLENGE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe('sanitizePasskey — never leaks key material', () => {
  const stored = {
    id: 'cred-1', publicKey: 'SECRETKEYBYTES', counter: 7,
    transports: ['internal'], userId: 'u1', deviceName: 'iPhone',
    rpId: 'pricing.aryadesigns.co.in', createdAt: '2026-07-05T10:00:00Z',
  };

  it('keeps only display fields', () => {
    expect(sanitizePasskey(stored)).toEqual({
      id: 'cred-1', deviceName: 'iPhone',
      rpId: 'pricing.aryadesigns.co.in', createdAt: '2026-07-05T10:00:00Z',
    });
  });

  it('omits publicKey, counter, userId and transports', () => {
    const out = sanitizePasskey(stored);
    expect(out).not.toHaveProperty('publicKey');
    expect(out).not.toHaveProperty('counter');
    expect(out).not.toHaveProperty('userId');
    expect(out).not.toHaveProperty('transports');
  });

  it('falls back to "Unnamed device" for a missing name', () => {
    expect(sanitizePasskey({ ...stored, deviceName: '' }).deviceName).toBe('Unnamed device');
  });
});

describe('passkeysForRp — credentials are scoped per rpId', () => {
  const list = [
    { id: 'a', rpId: 'pricing.aryadesigns.co.in' },
    { id: 'b', rpId: 'kreeva-lifestyle.github.io' },
    { id: 'c', rpId: 'pricing.aryadesigns.co.in' },
  ];

  it('returns only matching-rpId credentials', () => {
    expect(passkeysForRp(list, 'pricing.aryadesigns.co.in').map(p => p.id)).toEqual(['a', 'c']);
    expect(passkeysForRp(list, 'kreeva-lifestyle.github.io').map(p => p.id)).toEqual(['b']);
  });

  it('handles empty/null lists', () => {
    expect(passkeysForRp([], 'x')).toEqual([]);
    expect(passkeysForRp(null, 'x')).toEqual([]);
  });
});

describe('passkeysForUser — per-user scoping (list/remove/status)', () => {
  const list = [
    { id: 'a', rpId: 'pricing.aryadesigns.co.in', userId: 'u1' },
    { id: 'b', rpId: 'pricing.aryadesigns.co.in', userId: 'u2' },
    { id: 'c', rpId: 'pricing.aryadesigns.co.in', userId: 'u1' },
    { id: 'd', rpId: 'kreeva-lifestyle.github.io', userId: 'u1' },
  ];

  it('returns only the given user\'s credentials on the given rpId', () => {
    expect(passkeysForUser(list, 'pricing.aryadesigns.co.in', 'u1').map(p => p.id)).toEqual(['a', 'c']);
    expect(passkeysForUser(list, 'pricing.aryadesigns.co.in', 'u2').map(p => p.id)).toEqual(['b']);
  });

  it('does NOT leak another user\'s credentials (privacy)', () => {
    const u1 = passkeysForUser(list, 'pricing.aryadesigns.co.in', 'u1');
    expect(u1.some(p => p.userId !== 'u1')).toBe(false);
  });

  it('scopes by rpId too (same user, different domain excluded)', () => {
    expect(passkeysForUser(list, 'pricing.aryadesigns.co.in', 'u1').map(p => p.id)).not.toContain('d');
    expect(passkeysForUser(list, 'kreeva-lifestyle.github.io', 'u1').map(p => p.id)).toEqual(['d']);
  });

  it('unknown user gets an empty list; handles empty/null', () => {
    expect(passkeysForUser(list, 'pricing.aryadesigns.co.in', 'nobody')).toEqual([]);
    expect(passkeysForUser([], 'x', 'u1')).toEqual([]);
    expect(passkeysForUser(null, 'x', 'u1')).toEqual([]);
  });
});

describe('isWebAuthnResponse — response shape gate', () => {
  it('accepts a minimal attestation/assertion shape', () => {
    expect(isWebAuthnResponse({
      id: 'abc', rawId: 'abc', type: 'public-key',
      response: { clientDataJSON: 'x' },
    })).toBe(true);
  });

  it('rejects malformed inputs', () => {
    expect(isWebAuthnResponse(null)).toBe(false);
    expect(isWebAuthnResponse('string')).toBe(false);
    expect(isWebAuthnResponse({})).toBe(false);
    expect(isWebAuthnResponse({ id: 'a', rawId: 'b', type: 'public-key' })).toBe(false); // no response
    expect(isWebAuthnResponse({ id: 1, rawId: 'b', type: 'public-key', response: {} })).toBe(false); // id not string
  });
});

describe('cleanDeviceName — label hygiene', () => {
  it('trims and passes through normal names', () => {
    expect(cleanDeviceName('  My iPhone ')).toBe('My iPhone');
  });

  it('strips angle brackets (no markup smuggling)', () => {
    expect(cleanDeviceName('<script>x</script>')).toBe('scriptx/script');
  });

  it('caps length at 60 chars', () => {
    expect(cleanDeviceName('x'.repeat(200))).toHaveLength(60);
  });

  it('falls back for empty/null', () => {
    expect(cleanDeviceName('')).toBe('Unnamed device');
    expect(cleanDeviceName(null)).toBe('Unnamed device');
    expect(cleanDeviceName(undefined)).toBe('Unnamed device');
  });
});
