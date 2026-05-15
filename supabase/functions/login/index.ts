import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// SHA-256 hash with salt (mirrors client-side secureHash)
async function hashWithSalt(str: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function secureHash(str: string): Promise<string> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hash = await hashWithSalt(str, salt);
  return "sha256:" + salt + ":" + hash;
}

// Legacy hash for backward compatibility
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
    // Unsalted legacy: sha256:<hash>
    const data = new TextEncoder().encode(pass);
    const buf = await crypto.subtle.digest("SHA-256", data);
    const unsalted = "sha256:" + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return storedHash === unsalted;
  }
  return storedHash === legacyHash(pass);
}

interface LoginAttempt {
  count: number;
  firstAttempt: number;
  lockedUntil: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
    }

    const { email, password } = await req.json();
    if (!email || !password) {
      return jsonResponse({ error: "Email and password required" }, 400);
    }

    const emailLower = email.trim().toLowerCase();
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Server-side rate limiting
    const { data: rateData } = await db.from("app_data").select("value").eq("key", "pd_login_attempts").single();
    const attempts: Record<string, LoginAttempt> = rateData?.value || {};
    const now = Date.now();
    const rec = attempts[emailLower] || { count: 0, firstAttempt: now, lockedUntil: 0 };

    if (now < rec.lockedUntil) {
      const waitSec = Math.ceil((rec.lockedUntil - now) / 1000);
      return jsonResponse({ error: `Too many attempts. Try again in ${waitSec}s.` }, 429);
    }

    if (now - rec.firstAttempt > 15 * 60 * 1000) {
      rec.count = 0;
      rec.firstAttempt = now;
    }

    // Load users
    const { data: userData, error: userErr } = await db.from("app_data").select("value").eq("key", "pd_users").single();
    if (userErr || !userData?.value) {
      return jsonResponse({ error: "User system unavailable" }, 500);
    }

    const users: any[] = userData.value;
    const user = users.find((u: any) => u.email?.toLowerCase() === emailLower);

    if (!user || user.revoked) {
      // Track failed attempt
      rec.count++;
      if (rec.count > 5) {
        rec.lockedUntil = now + 60 * 1000;
      }
      attempts[emailLower] = rec;
      await db.from("app_data").upsert({ key: "pd_login_attempts", value: attempts, updated_at: new Date().toISOString() }, { onConflict: "key" });

      return jsonResponse({ error: "Invalid email or password." }, 401);
    }

    // Password verification
    const storedHash = user.passwordHash || null;
    const defaultPass = "pricedesk123";
    let valid = false;

    if (storedHash) {
      valid = await verifyPassword(password, storedHash);
    } else {
      valid = password === defaultPass;
    }

    if (!valid) {
      rec.count++;
      if (rec.count > 5) {
        rec.lockedUntil = now + 60 * 1000;
      }
      attempts[emailLower] = rec;
      await db.from("app_data").upsert({ key: "pd_login_attempts", value: attempts, updated_at: new Date().toISOString() }, { onConflict: "key" });

      return jsonResponse({ error: "Invalid email or password." }, 401);
    }

    // Clear rate limit on success
    delete attempts[emailLower];
    await db.from("app_data").upsert({ key: "pd_login_attempts", value: attempts, updated_at: new Date().toISOString() }, { onConflict: "key" });

    // Upgrade hash if needed (first login or unsalted)
    const isFirstLogin = !storedHash;
    const needsUpgrade = storedHash && (!storedHash.startsWith("sha256:") || storedHash.split(":").length < 3);

    if (isFirstLogin || needsUpgrade) {
      user.passwordHash = await secureHash(password);
      await db.from("app_data").upsert({ key: "pd_users", value: users, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }

    // Return user data WITHOUT passwordHash
    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || "viewer",
      revoked: !!user.revoked,
      added: user.added || user.createdAt,
    };

    return jsonResponse({
      user: safeUser,
      isFirstLogin,
      serverAuth: true,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});
