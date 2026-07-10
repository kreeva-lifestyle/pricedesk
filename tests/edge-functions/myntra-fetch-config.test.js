import { describe, it, expect } from 'vitest';
import { validateCredentials, shouldRunCommand } from '../../tools/myntra-fetch/config.mjs';

// Guards the laptop fetcher's config validation — turns the cryptic
// "Cannot convert argument to a ByteString" (a non-ASCII char pasted into the
// key) into a plain-English error, and trims stray paste whitespace.

const GOOD_URL = 'https://fcmesdnagvrdmjzzuwue.supabase.co';
const GOOD_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.fS1ecV898Dmrka6hr3R0RE6gcKlneWUPbDyDPv30_qU';
const BULLET = String.fromCharCode(8226); // • — the real-world offending char

describe('validateCredentials', () => {
  it('accepts a clean URL + JWT and trims surrounding whitespace', () => {
    const r = validateCredentials(`  ${GOOD_URL}\n`, `\t${GOOD_ANON}  `);
    expect(r).toEqual({ url: GOOD_URL, anon: GOOD_ANON });
  });

  it('rejects a bullet pasted into the key — the real-world failure', () => {
    const bad = GOOD_ANON.slice(0, 8) + BULLET + GOOD_ANON.slice(8);
    expect(() => validateCredentials(GOOD_URL, bad)).toThrow(/SUPABASE_ANON key contains an invalid/i);
    expect(() => validateCredentials(GOOD_URL, bad)).toThrow(/position 9/);
  });

  it('rejects non-ASCII in the URL too', () => {
    const badUrl = GOOD_URL.replace('supabase', 'supa' + BULLET + 'base');
    expect(() => validateCredentials(badUrl, GOOD_ANON)).toThrow(/SUPABASE_URL contains an invalid/i);
  });

  it('reports missing values clearly', () => {
    expect(() => validateCredentials('', GOOD_ANON)).toThrow(/Missing SUPABASE_URL/);
    expect(() => validateCredentials(GOOD_URL, '   ')).toThrow(/Missing SUPABASE_URL/);
  });

  it('rejects a non-https URL', () => {
    expect(() => validateCredentials('http://x.supabase.co', GOOD_ANON)).toThrow(/should start with https/);
  });

  it('rejects a token that is not a JWT shape', () => {
    expect(() => validateCredentials(GOOD_URL, 'not-a-real-key')).toThrow(/does not look like a valid key/);
  });
});

describe('shouldRunCommand — watcher decision', () => {
  const now = 1_000_000_000_000;
  const iso = (ms) => new Date(ms).toISOString();

  it('runs a fresh request the watcher has not processed', () => {
    const cmd = { requestedAt: iso(now - 5000) };
    expect(shouldRunCommand(cmd, {}, 0, now)).toBe(true);
  });
  it('does not run a request already processed by this watcher', () => {
    const cmd = { requestedAt: iso(now - 5000) };
    expect(shouldRunCommand(cmd, {}, now - 5000, now)).toBe(false);
  });
  it('does not run a request older than the last completed run', () => {
    const cmd = { requestedAt: iso(now - 10000) };
    const status = { finishedAt: iso(now - 5000) };
    expect(shouldRunCommand(cmd, status, 0, now)).toBe(false);
  });
  it('skips while another watcher is actively running it (fresh heartbeat)', () => {
    const cmd = { requestedAt: iso(now - 5000) };
    const status = { running: true, ts: now - 2000 };
    expect(shouldRunCommand(cmd, status, 0, now)).toBe(false);
  });
  it('runs again once that run finished before the request', () => {
    // request came AFTER the last finish, nothing running now
    const cmd = { requestedAt: iso(now - 1000) };
    const status = { running: false, finishedAt: iso(now - 5000), ts: now - 5000 };
    expect(shouldRunCommand(cmd, status, 0, now)).toBe(true);
  });
  it('treats a stale "running" heartbeat as claimable (laptop died mid-run)', () => {
    const cmd = { requestedAt: iso(now - 1000) };
    const status = { running: true, ts: now - 20 * 60 * 1000 }; // 20 min stale
    expect(shouldRunCommand(cmd, status, 0, now)).toBe(true);
  });
  it('is false with no request', () => {
    expect(shouldRunCommand({}, {}, 0, now)).toBe(false);
    expect(shouldRunCommand(null, null, 0, now)).toBe(false);
  });
});
