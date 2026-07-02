import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "crypto";
import { HERALD_PRODUCT } from "@/lib/intake/herald";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const source: string = body.source ?? "web";
    const prefill: Record<string, unknown> = body.prefill ?? {};
    // Public endpoint: whitelist, never persist arbitrary text.
    const intendedProduct: string | null =
      body.intendedProduct === HERALD_PRODUCT ? HERALD_PRODUCT : null;

    const sessionId = `sess_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    const initialState = prefill && Object.keys(prefill).length > 0
      ? { contact: prefill }
      : {};

    const { error } = await supabaseAdmin.from("intake_sessions").insert({
      id: sessionId,
      source,
      state: initialState,
      intended_product: intendedProduct,
    });

    if (error) throw error;

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://gb2gllc.com";

    return NextResponse.json({
      sessionId,
      createdAt: new Date().toISOString(),
      resumeUrl: `${base}/intake/${sessionId}`,
    });
  } catch (err) {
    console.error("intake/new error:", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
