import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { testStripeKey } from "@/lib/nora/stripe";
import { getNoraSecrets } from "@/lib/nora/env";

export const dynamic = "force-dynamic";

// POST /api/admin/nora/connect
// body: { label?: "..." }
// Reads NORA_STRIPE_SECRET_KEY + NORA_STRIPE_WEBHOOK_SECRET from env,
// validates the Stripe key, and creates the Nora account row. The key
// itself is NEVER stored — it lives only in the Vercel env vault.
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const secrets = getNoraSecrets();
  if (!secrets.ok) {
    return NextResponse.json({
      error: `Set these env vars in Vercel, then redeploy: ${secrets.missing.join(", ")}`,
    }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const labelOverride: unknown = body.label;

  // Validate the key against Stripe (live or test — auto-detected from prefix)
  const test = await testStripeKey(secrets.stripeSecretKey);
  if (!test.ok) return NextResponse.json({ error: `Stripe rejected NORA_STRIPE_SECRET_KEY: ${test.error}` }, { status: 400 });

  const label = (typeof labelOverride === "string" && labelOverride.trim()) ? labelOverride.trim() : test.account.label;

  const { data: existing, error: upErr } = await supabaseAdmin.from("nora_accounts").upsert(
    {
      workos_user_id: guard.user.id,
      label,
      stripe_account_id: test.account.id,
      livemode: test.account.livemode,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workos_user_id,label" }
  ).select("id").single();

  if (upErr || !existing) return NextResponse.json({ error: upErr?.message ?? "save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, account: { id: existing.id, label, livemode: test.account.livemode } });
}
