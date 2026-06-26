import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getHollisSecrets } from "@/lib/hollis/env";
import { createWebCall } from "@/lib/hollis/retell";

export const dynamic = "force-dynamic";

const DAILY_LIMIT_PER_IP = 5;

// Demo persona injected into the demo agent. Self-explaining + lets the visitor
// experience booking / FAQ / messages for a fictional business.
const DEMO_VARS: Record<string, string> = {
  business_name: "Maple & Co",
  agent_name: "Ava",
  services: "booking appointments, answering questions about our services, hours, and pricing, qualifying new customers, and taking messages",
  hours: "Monday to Saturday, 8 AM to 6 PM",
  faq: [
    "Q: Where are you located?\nA: 128 Maple Street, downtown — there's parking out back.",
    "Q: How much do your services cost?\nA: Most packages start around two hundred dollars; I can take your details and have someone send exact pricing.",
    "Q: Do you take walk-ins?\nA: We recommend booking ahead so we can give you our full attention.",
  ].join("\n\n"),
  escalation_number: "",
  greeting:
    "Hi there! I'm Ava — this is a live demo of the AI receptionist GB2G builds for businesses. " +
    "Ask me about our hours or services, try booking an appointment, or leave a message. " +
    "Go ahead — talk to me like you're calling a real business.",
};

export async function POST(req: Request) {
  if (!getHollisSecrets().ok) return NextResponse.json({ error: "Demo not configured yet." }, { status: 503 });
  const agentId = process.env.HOLLIS_DEMO_AGENT_ID;
  if (!agentId) return NextResponse.json({ error: "Demo not configured yet." }, { status: 503 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("hollis_demo_calls")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT_PER_IP) {
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
