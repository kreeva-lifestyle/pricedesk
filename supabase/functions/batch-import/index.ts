import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateBatch } from "./validate.ts";

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

    const { valid, rows, errors } = validateBatch(body);
    if (!valid) {
      return jsonResponse({ error: "Validation failed", errors }, 400, cors);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Single atomic upsert. Postgres processes all rows in one transaction —
    // if any row violates a constraint, none are written.
    const { error: dbError, data: writtenRows } = await db
      .from("pd_skus_v2")
      .upsert(rows, { onConflict: "id" })
      .select("id");

    if (dbError) {
      return jsonResponse({
        error: "Database write failed",
        message: dbError.message,
        details: dbError.details ?? null,
        hint: dbError.hint ?? null,
      }, 500, cors);
    }

    return jsonResponse({
      ok: true,
      written: writtenRows?.length ?? rows.length,
      ids: writtenRows?.map((r: { id: string }) => r.id) ?? rows.map((r) => r.id),
    }, 200, cors);
  } catch (error) {
    return jsonResponse({
      error: "Unexpected error",
      message: (error as Error).message,
    }, 500, cors);
  }
});
