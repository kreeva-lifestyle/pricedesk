// Pure helpers for the webauthn Edge Function.
// Extracted into their own file so Vitest (Node) can import them
// without pulling in Deno runtime types or @simplewebauthn/server.

export interface StoredPasskey {
  id: string;          // credential id (base64url)
  publicKey: string;   // COSE public key (base64url)
  counter: number;
  transports?: string[];
  userId: string;
  deviceName: string;
  rpId: string;
  createdAt: string;
}

export interface PendingChallenge {
  userId?: string;     // set for registration challenges
  exp: number;         // epoch ms expiry
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Origin → RP ID map. WebAuthn credentials are scoped to an RP ID that
// must be a registrable suffix of the origin's host, so each serving
// origin gets its own rpId and its own set of credentials.
export const ORIGIN_RP: Record<string, string> = {
  "https://pricing.aryadesigns.co.in": "pricing.aryadesigns.co.in",
  "https://kreeva-lifestyle.github.io": "kreeva-lifestyle.github.io",
  "http://localhost:5173": "localhost",
  "http://localhost:4173": "localhost",
};

export function rpIdForOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return ORIGIN_RP[origin] || null;
}

// Prune expired challenges and validate one. Returns the pending record
// when the challenge exists and has not expired, else null. Mutates the
// map in place (caller persists it back).
export function takeChallenge(
  challenges: Record<string, PendingChallenge>,
  challenge: string,
  now: number,
): PendingChallenge | null {
  for (const key of Object.keys(challenges)) {
    if (challenges[key].exp <= now) delete challenges[key];
  }
  const rec = challenges[challenge];
  if (!rec) return null;
  delete challenges[challenge];
  return rec;
}

// Shape a stored passkey for client display — never expose the public key.
export function sanitizePasskey(p: StoredPasskey) {
  return {
    id: p.id,
    deviceName: p.deviceName || "Unnamed device",
    rpId: p.rpId,
    createdAt: p.createdAt,
  };
}

export function passkeysForRp(list: StoredPasskey[], rpId: string): StoredPasskey[] {
  return (list || []).filter((p) => p && p.rpId === rpId);
}

// Basic shape check for a client WebAuthn response (attestation or assertion).
export function isWebAuthnResponse(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.rawId === "string" &&
    typeof o.type === "string" && !!o.response && typeof o.response === "object";
}

// Device-name hygiene: trim, strip angle brackets, cap length.
export function cleanDeviceName(name: unknown): string {
  const s = String(name ?? "").replace(/[<>]/g, "").trim();
  return (s || "Unnamed device").slice(0, 60);
}
