// WebAuthn / passkey Edge Function — server-verified Face ID / fingerprint
// sign-in. Actions:
//   register-options : password re-auth → registration challenge
//   register-verify  : verify attestation, store credential in pd_passkeys
//   login-options    : authentication challenge for this origin's credentials
//   login-verify     : verify assertion → same response shape as `login`
//   list / remove    : passkey management (password re-auth)
//
// Credentials live in app_data key `pd_passkeys`; pending challenges in
// `pd_webauthn_challenges` (5-min TTL). Only this function (service role)
// touches either key.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@10.0.1";
import {
  CHALLENGE_TTL_MS,
  cleanDeviceName,
  isWebAuthnResponse,
  ORIGIN_RP,
  passkeysForRp,
  rpIdForOrigin,
  sanitizePasskey,
  takeChallenge,
  type PendingChallenge,
  type StoredPasskey,
} from "./validate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RP_NAME = "PriceDesk";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowOrigin = origin && ORIGIN_RP[origin] ? origin : "https://pricing.aryadesigns.co.in";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonResponse(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── password verification (mirrors the `login` function) ──────────
async function hashWithSalt(str: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function legacyHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return "h" + Math.abs(hash).toString(36);
}

async function verifyPassword(pass: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  if (storedHash.startsWith("sha256:")) {
    const parts = storedHash.split(":");
    if (parts.length === 3) {
      const computed = await hashWithSalt(pass, parts[1]);
      return parts[2] === computed;
    }
    const data = new TextEncoder().encode(pass);
    const buf = await crypto.subtle.digest("SHA-256", data);
    const unsalted = "sha256:" +
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return storedHash === unsalted;
  }
  return storedHash === legacyHash(pass);
}

// ── app_data helpers ───────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Db = any;

async function loadKey<T>(db: Db, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("app_data").select("value").eq("key", key).single();
  return (data?.value as T) ?? fallback;
}

async function saveKey(db: Db, key: string, value: unknown): Promise<void> {
  await db.from("app_data").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

// Re-authenticate email+password against pd_users. Returns the user row
// or null. Failed attempts feed the same pd_login_attempts record the
// `login` function uses.
// deno-lint-ignore no-explicit-any
async function reauth(db: Db, email: string, password: string): Promise<any | null> {
  const emailLower = String(email || "").trim().toLowerCase();
  if (!emailLower || !password) return null;

  const attempts = await loadKey<Record<string, { count: number; firstAttempt: number; lockedUntil: number }>>(
    db, "pd_login_attempts", {},
  );
  const now = Date.now();
  const rec = attempts[emailLower] || { count: 0, firstAttempt: now, lockedUntil: 0 };
  if (now < rec.lockedUntil) return null;
  if (now - rec.firstAttempt > 15 * 60 * 1000) {
    rec.count = 0;
    rec.firstAttempt = now;
  }

  // deno-lint-ignore no-explicit-any
  const users = await loadKey<any[]>(db, "pd_users", []);
  const user = users.find((u) => u.email?.toLowerCase() === emailLower);
  const storedHash = user?.passwordHash || null;
  const ok = !!user && !user.revoked &&
    (storedHash ? await verifyPassword(password, storedHash) : password === "pricedesk123");

  if (!ok) {
    rec.count++;
    if (rec.count > 5) rec.lockedUntil = now + 60 * 1000;
    attempts[emailLower] = rec;
    await saveKey(db, "pd_login_attempts", attempts);
    return null;
  }
  return user;
}

// deno-lint-ignore no-explicit-any
function safeUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || "viewer",
    revoked: !!user.revoked,
    added: user.added || user.createdAt,
  };
}

const b64u = {
  enc: (buf: Uint8Array): string =>
    btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string): Uint8Array =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
};

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

    const origin = req.headers.get("Origin");
    const rpId = rpIdForOrigin(origin);
    if (!rpId || !origin) {
      return jsonResponse({ error: "Origin not allowed for passkeys" }, 403, cors);
    }

    const body = await req.json();
    const action = body?.action;
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const now = Date.now();

    // ── REGISTER: step 1 — password re-auth, issue creation options ──
    if (action === "register-options") {
      const user = await reauth(db, body.email, body.password);
      if (!user) return jsonResponse({ error: "Invalid email or password." }, 401, cors);

      const passkeys = await loadKey<StoredPasskey[]>(db, "pd_passkeys", []);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpId,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        userDisplayName: user.name || user.email,
        attestationType: "none",
        excludeCredentials: passkeysForRp(passkeys, rpId).map((p) => ({ id: p.id })),
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
      });

      const challenges = await loadKey<Record<string, PendingChallenge>>(db, "pd_webauthn_challenges", {});
      takeChallenge(challenges, "", now); // prune expired
      challenges[options.challenge] = { userId: user.id, exp: now + CHALLENGE_TTL_MS };
      await saveKey(db, "pd_webauthn_challenges", challenges);

      return jsonResponse({ options }, 200, cors);
    }

    // ── REGISTER: step 2 — verify attestation, store credential ──────
    if (action === "register-verify") {
      if (!isWebAuthnResponse(body.attResp)) {
        return jsonResponse({ error: "Malformed attestation response" }, 400, cors);
      }
      const clientData = JSON.parse(
        new TextDecoder().decode(b64u.dec(body.attResp.response.clientDataJSON)),
      );
      const challenges = await loadKey<Record<string, PendingChallenge>>(db, "pd_webauthn_challenges", {});
      const pending = takeChallenge(challenges, clientData.challenge, now);
      await saveKey(db, "pd_webauthn_challenges", challenges);
      if (!pending?.userId) {
        return jsonResponse({ error: "Challenge expired — try again" }, 400, cors);
      }

      const verification = await verifyRegistrationResponse({
        response: body.attResp,
        expectedChallenge: clientData.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return jsonResponse({ error: "Passkey verification failed" }, 400, cors);
      }

      const cred = verification.registrationInfo.credential;
      const passkeys = await loadKey<StoredPasskey[]>(db, "pd_passkeys", []);
      passkeys.push({
        id: cred.id,
        publicKey: b64u.enc(cred.publicKey),
        counter: cred.counter,
        transports: body.attResp.response.transports || [],
        userId: pending.userId,
        deviceName: cleanDeviceName(body.deviceName),
        rpId,
        createdAt: new Date().toISOString(),
      });
      await saveKey(db, "pd_passkeys", passkeys);

      return jsonResponse({ ok: true, passkeys: passkeysForRp(passkeys, rpId).map(sanitizePasskey) }, 200, cors);
    }

    // ── LOGIN: step 1 — authentication options ────────────────────────
    if (action === "login-options") {
      const passkeys = passkeysForRp(await loadKey<StoredPasskey[]>(db, "pd_passkeys", []), rpId);
      if (!passkeys.length) return jsonResponse({ error: "no_passkeys" }, 404, cors);

      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: "required",
        allowCredentials: passkeys.map((p) => ({
          id: p.id,
          transports: (p.transports || []) as AuthenticatorTransport[],
        })),
      });

      const challenges = await loadKey<Record<string, PendingChallenge>>(db, "pd_webauthn_challenges", {});
      takeChallenge(challenges, "", now); // prune expired
      challenges[options.challenge] = { exp: now + CHALLENGE_TTL_MS };
      await saveKey(db, "pd_webauthn_challenges", challenges);

      return jsonResponse({ options }, 200, cors);
    }

    // ── LOGIN: step 2 — verify assertion, return user ─────────────────
    if (action === "login-verify") {
      if (!isWebAuthnResponse(body.authResp)) {
        return jsonResponse({ error: "Malformed assertion response" }, 400, cors);
      }
      const clientData = JSON.parse(
        new TextDecoder().decode(b64u.dec(body.authResp.response.clientDataJSON)),
      );
      const challenges = await loadKey<Record<string, PendingChallenge>>(db, "pd_webauthn_challenges", {});
      const pending = takeChallenge(challenges, clientData.challenge, now);
      await saveKey(db, "pd_webauthn_challenges", challenges);
      if (!pending) return jsonResponse({ error: "Challenge expired — try again" }, 400, cors);

      const passkeys = await loadKey<StoredPasskey[]>(db, "pd_passkeys", []);
      const cred = passkeys.find((p) => p.id === body.authResp.id && p.rpId === rpId);
      if (!cred) return jsonResponse({ error: "Unknown passkey" }, 401, cors);

      const verification = await verifyAuthenticationResponse({
        response: body.authResp,
        expectedChallenge: clientData.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: cred.id,
          publicKey: b64u.dec(cred.publicKey),
          counter: cred.counter,
          transports: (cred.transports || []) as AuthenticatorTransport[],
        },
      });
      if (!verification.verified) {
        return jsonResponse({ error: "Passkey verification failed" }, 401, cors);
      }

      cred.counter = verification.authenticationInfo.newCounter;
      await saveKey(db, "pd_passkeys", passkeys);

      // deno-lint-ignore no-explicit-any
      const users = await loadKey<any[]>(db, "pd_users", []);
      const user = users.find((u) => u.id === cred.userId);
      if (!user || user.revoked) {
        return jsonResponse({ error: "Account not available" }, 401, cors);
      }

      return jsonResponse({ user: safeUser(user), serverAuth: true, passkey: true }, 200, cors);
    }

    // ── MANAGEMENT: list / remove (password re-auth) ──────────────────
    if (action === "list" || action === "remove") {
      const user = await reauth(db, body.email, body.password);
      if (!user) return jsonResponse({ error: "Invalid email or password." }, 401, cors);

      let passkeys = await loadKey<StoredPasskey[]>(db, "pd_passkeys", []);
      if (action === "remove") {
        const before = passkeys.length;
        passkeys = passkeys.filter((p) => p.id !== body.credentialId);
        if (passkeys.length === before) {
          return jsonResponse({ error: "Passkey not found" }, 404, cors);
        }
        await saveKey(db, "pd_passkeys", passkeys);
      }
      return jsonResponse({ ok: true, passkeys: passkeysForRp(passkeys, rpId).map(sanitizePasskey) }, 200, cors);
    }

    return jsonResponse({ error: "Unknown action" }, 400, cors);
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500, cors);
  }
});
