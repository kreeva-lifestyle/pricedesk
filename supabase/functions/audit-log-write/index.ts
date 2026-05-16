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

// Validate an audit entry. Only `action` is required; everything else is
// optional. Field lengths are bounded so a single entry can't blow up the
// table.
function validateEntry(raw: unknown): { entry: Record<string, unknown> | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { entry: null, error: "entry must be an object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.action !== "string" || r.action.length === 0) {
    return { entry: null, error: "action is required and must be a non-empty string" };
  }
  if (r.action.length > 100) {
    return { entry: null, error: "action must be <= 100 characters" };
  }
  for (const f of ["user", "userId", "details"] as const) {
    if (r[f] !== undefined && r[f] !== null && typeof r[f] !== "string") {
      return { entry: null, error: `${f} must be a string` };
    }
  }
  if (typeof r.details === "string" && r.details.length > 2000) {
    return { entry: null, error: "details must be <= 2000 characters" };
  }
  if (typeof r.user === "string" && r.user.length > 200) {
    return { entry: null, error: "user must be <= 200 characters" };
  }
  if (typeof r.userId === "string" && r.userId.length > 200) {
    return { entry: null, error: "userId must be <= 200 characters" };
  }
  // extra must be a plain object if present (we'll JSON-stringify to check size)
  if (r.extra !== undefined && r.extra !== null) {
    if (typeof r.extra !== "object" || Array.isArray(r.extra)) {
      return { entry: null, error: "extra must be an object if provided" };
    }
    if (JSON.stringify(r.extra).length > 4000) {
      return { entry: null, error: "extra must serialize to <= 4000 bytes" };
    }
  }
  return {
    entry: {
      user_name: typeof r.user === "string" ? r.user : null,
      user_id: typeof r.userId === "string" ? r.userId : null,
      action: r.action,
      details: typeof r.details === "string" ? r.details : null,
      extra: r.extra ?? null,
      // ts is intentionally NOT taken from the client — the DB default (NOW())
      // is the authoritative timestamp. Prevents clock-rolled forgery.
    },
    error: null,
  };
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405, cors);
  }

  try {
    if (!SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, 500, cors);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Body is not valid JSON" }, 400, cors);
    }

    // Body shape: { entry: { ... } }
    const rawEntry = (body as Record<string, unknown>)?.entry ?? body;
    const { entry, error: validationError } = validateEntry(rawEntry);
    if (validationError) {
      return jsonResponse({ error: "Validation failed", message: validationError }, 400, cors);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: dbError } = await db.from("pd_audit_log").insert(entry as never);
    if (dbError) {
      return jsonResponse({ error: "Database write failed", message: dbError.message }, 500, cors);
    }

    return jsonResponse({ ok: true }, 200, cors);
  } catch (error) {
    return jsonResponse({ error: "Unexpected error", message: (error as Error).message }, 500, cors);
  }
});
