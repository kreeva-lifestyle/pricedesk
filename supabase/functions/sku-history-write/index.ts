import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function validateEntry(raw: unknown): { entry: Record<string, unknown> | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { entry: null, error: "entry must be an object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.sku_id !== "string" || r.sku_id.length === 0) return { entry: null, error: "sku_id is required" };
  if (r.sku_id.length > 200) return { entry: null, error: "sku_id must be <= 200 chars" };
  if (typeof r.field !== "string" || r.field.length === 0) return { entry: null, error: "field is required" };
  if (r.field.length > 100) return { entry: null, error: "field must be <= 100 chars" };
  for (const f of ["old_val", "new_val", "user_name"] as const) {
    if (r[f] !== undefined && r[f] !== null && typeof r[f] !== "string") {
      return { entry: null, error: `${f} must be a string` };
    }
    if (typeof r[f] === "string" && (r[f] as string).length > 2000) {
      return { entry: null, error: `${f} must be <= 2000 chars` };
    }
  }
  return {
    entry: {
      sku_id: r.sku_id,
      field: r.field,
      old_val: typeof r.old_val === "string" ? r.old_val : null,
      new_val: typeof r.new_val === "string" ? r.new_val : null,
      user_name: typeof r.user_name === "string" ? r.user_name : null,
      // ts: omitted - DB DEFAULT NOW() is authoritative
    },
    error: null,
  };
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed. Use POST." }, 405, cors);
  try {
    if (!SERVICE_ROLE_KEY) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, 500, cors);
    let body: unknown;
    try { body = await req.json(); } catch { return jsonResponse({ error: "Body is not valid JSON" }, 400, cors); }
    const rawEntry = (body as Record<string, unknown>)?.entry ?? body;
    const { entry, error: validationError } = validateEntry(rawEntry);
    if (validationError) return jsonResponse({ error: "Validation failed", message: validationError }, 400, cors);
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: dbError } = await db.from("pd_sku_history").insert(entry as never);
    if (dbError) return jsonResponse({ error: "Database write failed", message: dbError.message }, 500, cors);
    return jsonResponse({ ok: true }, 200, cors);
  } catch (error) {
    return jsonResponse({ error: "Unexpected error", message: (error as Error).message }, 500, cors);
  }
});
