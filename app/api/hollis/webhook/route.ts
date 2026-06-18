import { NextResponse } from "next/server";
import { getHollisSecrets } from "@/lib/hollis/env";
import { verifyRetellSignature, parseLifecycle } from "@/lib/hollis/webhook";
import { inngest } from "@/lib/inngest/client";

export const dynamic = "force-dynamic";

// Retell call-lifecycle webhook (call_started | call_ended | call_analyzed).
// Verify, fast-ack with 200, and hand the post-call work to Inngest. All slow
// work (persist, redact, ticket, deliver) happens in hollis/call.completed.
export async function POST(req: Request) {
  const raw = await req.text();
  const secrets = getHollisSecrets();
  if (!secrets.ok || !verifyRetellSignature(raw, req.headers.get("x-retell-signature"), secrets.retellApiKey)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = parseLifecycle(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (parsed.event === "call_analyzed" && parsed.retellCallId && parsed.toNumber) {
    await inngest.send({ name: "hollis/call.completed", data: { parsed } });
  }

  return NextResponse.json({ ok: true });
}
