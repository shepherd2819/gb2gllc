import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractIp } from "@/lib/june/store";

export const dynamic = "force-dynamic";

// Client polls this endpoint while the audit / email is running to know when
// the background work completes. Returns the latest status + audit_data preview.
export async function GET(req: NextRequest) {
  const ip = extractIp(req);
  const { data } = await supabaseAdmin
    .from("june_demo_attempts")
    .select("status, error, audit_data, website_url, email_sent_at, pdf_generated_at")
    .eq("ip", ip)
    .maybeSingle();

  if (!data) return NextResponse.json({ status: "none" });

  return NextResponse.json({
    status: data.status,
    error: data.error ?? null,
    website_url: data.website_url ?? null,
    pdf_generated_at: data.pdf_generated_at ?? null,
    email_sent_at: data.email_sent_at ?? null,
    preview: data.audit_data
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          company_name: (data.audit_data as any).company_name ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          opportunity_count: ((data.audit_data as any).opportunities ?? []).length,
        }
      : null,
  });
}
