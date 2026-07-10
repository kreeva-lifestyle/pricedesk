// Pure config-validation helpers for the laptop fetcher — no imports, so tests
// (and the main project's Vitest) can load it without pulling in
// @supabase/supabase-js (which only lives in this tool's own node_modules).

// Validate + clean the two Supabase credential strings. Copy-paste from a
// masked/hidden field can inject non-ASCII characters (e.g. a "•" bullet),
// which later blow up deep inside the Supabase client with a cryptic
// "Cannot convert argument to a ByteString" error. Catch it here with a plain
// message. Returns { url, anon } (trimmed) or throws with a friendly reason.
export function validateCredentials(rawUrl, rawAnon) {
  const url = String(rawUrl || "").trim();
  const anon = String(rawAnon || "").trim();
  if (!url || !anon) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_ANON. Copy config.example.json to config.json and fill them in.",
    );
  }
  const firstBadChar = (s) => {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      // Printable ASCII only — anything else came from a bad copy/paste.
      if (code < 32 || code > 126) {
        return `character "${s[i]}" (code ${code}) at position ${i + 1}`;
      }
    }
    return "";
  };
  const badAnon = firstBadChar(anon);
  if (badAnon) {
    throw new Error(
      `Your SUPABASE_ANON key contains an invalid ${badAnon}. ` +
        "This usually happens when the key is copied from a hidden/masked field. " +
        "Open config.json and re-paste the key as plain text (letters, numbers and dots only).",
    );
  }
  const badUrl = firstBadChar(url);
  if (badUrl) {
    throw new Error(
      `Your SUPABASE_URL contains an invalid ${badUrl}. Re-paste it as plain text in config.json.`,
    );
  }
  if (!/^https:\/\//.test(url)) {
    throw new Error(`SUPABASE_URL should start with https:// — got "${url.slice(0, 40)}".`);
  }
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(anon)) {
    throw new Error(
      "SUPABASE_ANON does not look like a valid key (expected a long token starting with 'eyJ' and containing two dots). Re-copy it from config.example.json.",
    );
  }
  return { url, anon };
}

// Decide whether a watcher should start a fetch for a webapp-requested run.
// Pure (no I/O) so it's unit-testable and shared by the watch loop.
//   command = pd_live_command  { requestedAt: ISO }
//   status  = pd_live_status   { running, finishedAt, ts }
//   lastProcessedAt = ms of the newest request this watcher already started
//   nowMs, stallMs = clock + heartbeat freshness window
// Runs iff there is a request that is newer than both what we've already
// handled and the last completed run, AND no run is currently in progress
// (a fresh heartbeat means another watcher already claimed it).
export function shouldRunCommand(command, status, lastProcessedAt, nowMs, stallMs = 15 * 60 * 1000) {
  const req = command && command.requestedAt ? Date.parse(command.requestedAt) : NaN;
  if (!Number.isFinite(req)) return false;
  if (req <= (lastProcessedAt || 0)) return false;
  const finished = status && status.finishedAt ? Date.parse(status.finishedAt) : 0;
  if (req <= (finished || 0)) return false; // already served by a completed run
  const runningFresh = !!(status && status.running && status.ts && nowMs - status.ts < stallMs);
  if (runningFresh) return false; // someone is actively running it
  return true;
}
