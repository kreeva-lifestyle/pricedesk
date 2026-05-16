import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateBatch } from "./validate.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    if (!SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, 500);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Body is not valid JSON" }, 400);
    }

    const { valid, rows, errors } = validateBatch(body);
    if (!valid) {
      return jsonResponse({ error: "Validation failed", errors }, 400);
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
      }, 500);
    }

    return jsonResponse({
      ok: true,
      written: writtenRows?.length ?? rows.length,
      ids: writtenRows?.map((r: { id: string }) => r.id) ?? rows.map((r) => r.id),
    });
  } catch (error) {
    return jsonResponse({
      error: "Unexpected error",
      message: (error as Error).message,
    }, 500);
  }
});
