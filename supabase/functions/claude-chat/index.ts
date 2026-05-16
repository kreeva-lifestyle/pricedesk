import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Per-IP rate limit. Anthropic costs real money; even a friendly bug in
// client code or a curl loop with the anon key shouldn't be able to drain
// the budget. 30 requests per rolling 60-second window is far above any
// legitimate single-user use (~6/min sustained) and well below where it
// would impact a real human user.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

interface RateRecord { count: number; firstAt: number; }
type RateMap = Record<string, RateRecord>;

function clientIp(req: Request): string {
  // Supabase Edge Functions sit behind Cloudflare-style proxies; trust the
  // first hop in x-forwarded-for (closest to the client).
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || "unknown";
}

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!SERVICE_ROLE_KEY) return { allowed: true, retryAfterSec: 0 };
  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data } = await db.from("app_data").select("value").eq("key", "pd_chat_rate_limits").single();
    const map: RateMap = (data?.value as RateMap) || {};
    const now = Date.now();
    // Drop expired records
    for (const k of Object.keys(map)) {
      if (now - map[k].firstAt > RATE_LIMIT_WINDOW_MS) delete map[k];
    }
    const rec = map[ip] || { count: 0, firstAt: now };
    if (now - rec.firstAt > RATE_LIMIT_WINDOW_MS) {
      rec.count = 0;
      rec.firstAt = now;
    }
    rec.count++;
    map[ip] = rec;
    await db.from("app_data").upsert(
      { key: "pd_chat_rate_limits", value: map, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (rec.count > RATE_LIMIT_MAX) {
      const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - rec.firstAt)) / 1000);
      return { allowed: false, retryAfterSec: Math.max(retryAfterSec, 1) };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch (_e) {
    // Fail-open if rate-limit storage is unavailable — better to serve
    // requests than to deny a legitimate user because of a DB hiccup.
    return { allowed: true, retryAfterSec: 0 };
  }
}

// Origin allowlist — only browsers on these origins can call this function.
// Server-side / curl callers still work (they don't send Origin) but are not
// the CORS threat model. Add/remove origins here when deploying to new hosts.
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

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set in Edge Function secrets");
    }

    // Per-IP rate limit — protects the Anthropic budget from abuse.
    const ip = clientIp(req);
    const gate = await checkRateLimit(ip);
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({ error: `Rate limit exceeded. Try again in ${gate.retryAfterSec}s.` }),
        { status: 429, headers: { ...cors, "Content-Type": "application/json", "Retry-After": String(gate.retryAfterSec) } },
      );
    }

    const { message, context } = await req.json();

    if (!message || typeof message !== "string") {
      throw new Error("Message is required");
    }

    const systemPrompt = `You are PriceDesk AI — an expert pricing analyst for Indian fashion e-commerce (Myntra, Ajio, Amazon marketplaces).

You have access to the user's live business data provided below. Use it to answer questions accurately with specific numbers.

BUSINESS CONTEXT:
${context || "No data provided."}

GUIDELINES:
- Always use ₹ symbol for Indian Rupees
- Reference specific SKU codes, categories, and brands from the data
- Give actionable recommendations, not vague advice
- When suggesting price changes, show the profit impact
- Keep responses concise — bullet points over paragraphs
- If asked about something not in the data, say so honestly
- Format numbers with Indian locale (e.g., ₹1,23,456)
- You understand GST brackets: 5% for Customer Paid < ₹2,500, 18% for ≥ ₹2,500`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "No response from Claude.";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
