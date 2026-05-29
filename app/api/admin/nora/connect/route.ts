import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { testStripeKey } from "@/lib/nora/stripe";

export const dynamic = "force-dynamic";

// POST /api/admin/nora/connect
// body: { secret_key: "rk_live_..."  OR  "sk_..."  , webhook_secret?: "whsec_..."  , label?: "..." }
// Validates the key by calling /v1/account, then upserts a nora_accounts row.
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const secret_key: unknown = body.secret_key;
  const webhook_secret: unknown = body.webhook_secret;
  const labelOverride: unknown = body.label;

  if (typeof secret_key !== "string" || !secret_key.trim()) {
    return NextResponse.json({ error: "secret_key required" }, { status: 400 });
  }
  if (!/^(sk|rk)_(live|test)_/.test(secret_key)) {
    return NextResponse.json({ error: "key must start with sk_live_, sk_test_, rk_live_, or rk_test_" }, { status: 400 });
  }
  if (webhook_secret !== undefined && webhook_secret !== null && (typeof webhook_secret !== "string" || (webhook_secret && !webhook_secret.startsWith("whsec_")))) {
    return NextResponse.json({ error: "webhook_secret must start with whsec_" }, { status: 400 });
  }

  // Validate the key against Stripe
  const test = await testStripeKey(secret_key);
  if (!test.ok) return NextResponse.json({ error: `Stripe rejected the key: ${test.error}` }, { status: 400 });

  const label = (typeof labelOverride === "string" && labelOverride.trim()) ? labelOverride.trim() : test.account.label;

  const { data: existing, error: upErr } = await supabaseAdmin.from("nora_accounts").upsert(
    {
      workos_user_id: guard.user.id,
      label,
      stripe_account_id: test.account.id,
      stripe_secret_key: secret_key,
      stripe_webhook_secret: webhook_secret || null,
      livemode: test.account.livemode,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workos_user_id,label" }
  ).select("id").single();

  if (upErr || !existing) return NextResponse.json({ error: upErr?.message ?? "save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, account: { id: existing.id, label, livemode: test.account.livemode } });
}
