import "https://deno.land/x/xhr@0.3.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

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
