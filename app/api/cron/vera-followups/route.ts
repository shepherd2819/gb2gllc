import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendReminder } from "@/lib/vera/notify";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";
import { logEvent } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const REMIND_AFTER_DAYS = 3;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const remindCutoff = new Date(now.getTime() - REMIND_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://gb2gllc.com";

  // 1. Reminders
  const { data: toRemind } = await supabaseAdmin
    .from("contracts")
    .select("id, token, product, amount_cents, cadence, client_id, clients(name, email, company)")
    .eq("status", "sent")
    .is("reminder_sent_at", null)
    .lt("sent_at", remindCutoff);

  let remindedCount = 0;
  for (const c of toRemind ?? []) {
    const client = c.clients as unknown as { name: string | null; email: string; company: string | null };
    if (!client?.email) continue;
    try {
      await sendReminder(client.email, {
        clientName:       client.name || "there",
        clientCompany:    client.company || client.name || "",
        productLabel:     PRODUCT_LABELS[c.product as Product],
        amountFormatted:  formatAmount(c.amount_cents as number),
        cadenceLabel:     cadenceLabel(c.cadence as Cadence),
        signingUrl:       `${marketingUrl}/sign/${c.token}`,
      });
      await supabaseAdmin.from("contracts").update({ reminder_sent_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", c.id);
      remindedCount++;
    } catch (err) {
      await logEvent({
        clientId: c.client_id as string, category: "vera", level: "warn",
        message: "reminder failed",
        metadata: { contract_id: c.id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // 2. Expiry
  const { data: expired } = await supabaseAdmin
    .from("contracts")
    .update({ status: "expired", updated_at: now.toISOString() })
    .eq("status", "sent")
    .lt("expires_at", now.toISOString())
    .select("id");

  return NextResponse.json({ reminded: remindedCount, expired: (expired ?? []).length });
}
