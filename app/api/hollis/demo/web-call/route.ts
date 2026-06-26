import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getHollisSecrets } from "@/lib/hollis/env";
import { createWebCall } from "@/lib/hollis/retell";

export const dynamic = "force-dynamic";

const DAILY_LIMIT_PER_IP = 5;
// Hard backstop across ALL callers — bounds total demo spend per day even if the
// per-IP limit is bypassed (spoofed IPs) or raced (TOCTOU between count + insert).
const GLOBAL_DAILY_LIMIT = 150;

// Browser-only endpoint: only our marketing site should call it. Blocks scripted
// cross-origin abuse that would drain the demo voice-minute budget.
function originAllowed(origin: string): boolean {
  if (!origin) return false;
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://gb2gllc.com";
  const allow = new Set([base, "https://gb2gllc.com", "https://www.gb2gllc.com", "http://localhost:3000"]);
  return allow.has(origin);
}

// Trust only the platform-set client IP. x-forwarded-for's leftmost value is
// client-controllable on Vercel; x-real-ip is set by the proxy.
function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] || "unknown"; // rightmost = nearest trusted hop
}

// The demo agent IS GB2G's own AI concierge — it answers questions about GB2G
// and explains what an AI agent could do for the caller's business, then offers
// to capture their details for a follow-up.
const DEMO_VARS: Record<string, string> = {
  business_name: "GB2G",
  agent_name: "Ava",
  services:
    "explaining what GB2G builds — AI employees, intelligent websites, and internal automation — " +
    "showing what an AI phone receptionist could do for the caller's own business, and taking their details for a follow-up",
  hours: "available 24/7 — GB2G's AI agents never sleep",
  faq: [
    "Q: What does GB2G do?\nA: We build AI employees, intelligent websites, and internal automation for businesses. Our three products are Herald, an AI assistant for your website; Atrium, intelligent websites we design and build; and Steward, AI employees that handle real work for you. And we're founded in faith.",
    "Q: What is this — what can you do?\nA: I'm the kind of AI receptionist GB2G sets up for businesses. I answer every call in a natural voice, book appointments, qualify leads, answer common questions, and take messages or transfer to a person — around the clock, never missing a call.",
    "Q: What could you do for my business?\nA: Tell me a bit about your business and I'll explain how an AI receptionist would handle your calls — booking, questions, after-hours, and overflow — so you never lose a lead to voicemail.",
    "Q: How much does it cost?\nA: It depends on what you need. If you share your name and number, the team will put together options and reach out.",
    "Q: How do we get started?\nA: Just give me your name, your business, and the best number, and I'll pass it to the team to set you up.",
    "Q: Are you a real person?\nA: Nope — I'm an AI agent, and a live example of exactly what GB2G builds. Pretty human, right?",
  ].join("\n\n"),
  escalation_number: "",
  greeting:
    "Hi! I'm Ava, an AI agent built by GB2G — the same kind of AI receptionist we set up for businesses. " +
    "Ask me anything about GB2G, what our AI agents can do, or what we could build for your business. " +
    "And if you'd like the team to follow up, just give me your name and number.",
};

export async function POST(req: Request) {
  if (!originAllowed(req.headers.get("origin") ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!getHollisSecrets().ok) return NextResponse.json({ error: "Demo not configured yet." }, { status: 503 });
  const agentId = process.env.HOLLIS_DEMO_AGENT_ID;
  if (!agentId) return NextResponse.json({ error: "Demo not configured yet." }, { status: 503 });

  const ip = clientIp(req);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [{ count: ipCount }, { count: globalCount }] = await Promise.all([
    supabaseAdmin.from("hollis_demo_calls").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since),
    supabaseAdmin.from("hollis_demo_calls").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);

  if ((globalCount ?? 0) >= GLOBAL_DAILY_LIMIT) {
    return NextResponse.json({ error: "Our demo line is busy today — reach out and we'll set up a real line for you." }, { status: 429 });
  }
  if ((ipCount ?? 0) >= DAILY_LIMIT_PER_IP) {
    return NextResponse.json({ error: "You've used today's demo calls — reach out and we'll set up a real line for you." }, { status: 429 });
  }

  try {
    const call = await createWebCall(agentId, DEMO_VARS);
    await supabaseAdmin.from("hollis_demo_calls").insert({ ip, call_id: call.call_id });
    return NextResponse.json({ access_token: call.access_token, call_id: call.call_id });
  } catch (err) {
    console.error("[hollis/demo] web-call failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not start the demo call. Try again in a moment." }, { status: 502 });
  }
}
