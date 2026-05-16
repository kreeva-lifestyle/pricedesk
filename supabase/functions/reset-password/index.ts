import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Origin allowlist — see claude-chat for rationale.
const ALLOWED_ORIGINS = new Set([
  "https://pricing.aryadesigns.co.in",
  "https://kreeva-lifestyle.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://pricing.aryadesigns.co.in";
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

function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    if (!SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
    }

    const body = await req.json();
    const { action } = body;
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (action === "request") {
      // Request a password reset token
      const email = body.email?.trim().toLowerCase();
      if (!email) return jsonResponse({ error: "Email required" }, 400, cors);

      // Always return generic success to prevent email enumeration
      const genericMsg = "If an account exists with that email, a reset link has been generated.";

      const { data: userData } = await db.from("app_data").select("value").eq("key", "pd_users").single();
      const users: any[] = userData?.value || [];
      const user = users.find((u: any) => u.email?.toLowerCase() === email);

      if (!user) {
        return jsonResponse({ message: genericMsg }, 200, cors);
      }

      // Generate token and store server-side
      const token = generateToken();
      const { data: tokenData } = await db.from("app_data").select("value").eq("key", "pd_reset_tokens").single();
      const tokens: Record<string, any> = tokenData?.value || {};

      tokens[token] = {
        userId: user.id,
        email: user.email,
        expires: Date.now() + 30 * 60 * 1000, // 30 minutes
      };

      await db.from("app_data").upsert(
        { key: "pd_reset_tokens", value: tokens, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

      return jsonResponse({
        message: genericMsg,
        token,
        userName: user.name,
        userEmail: user.email,
      }, 200, cors);

    } else if (action === "reset") {
      // Reset password using token
      const { token, newPassword } = body;
      if (!token || !newPassword) return jsonResponse({ error: "Token and new password required" }, 400, cors);
      if (newPassword.length < 6) return jsonResponse({ error: "Password must be at least 6 characters" }, 400, cors);

      // Validate token
      const { data: tokenData } = await db.from("app_data").select("value").eq("key", "pd_reset_tokens").single();
      const tokens: Record<string, any> = tokenData?.value || {};
      const entry = tokens[token];

      if (!entry || Date.now() > entry.expires) {
        return jsonResponse({ error: "Reset link has expired or is invalid." }, 400, cors);
      }

      // Find user and update password
      const { data: userData } = await db.from("app_data").select("value").eq("key", "pd_users").single();
      const users: any[] = userData?.value || [];
      const user = users.find((u: any) => u.id === entry.userId);

      if (!user) {
        return jsonResponse({ error: "User not found." }, 404, cors);
      }

      user.passwordHash = await secureHash(newPassword);
      await db.from("app_data").upsert(
        { key: "pd_users", value: users, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

      // Remove used token
      delete tokens[token];
      await db.from("app_data").upsert(
        { key: "pd_reset_tokens", value: tokens, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

      return jsonResponse({ message: "Password updated successfully." }, 200, cors);

    } else {
      return jsonResponse({ error: "Invalid action. Use 'request' or 'reset'." }, 400, cors);
    }
  } catch (error) {
    return jsonResponse({ error: error.message }, 500, cors);
  }
});
