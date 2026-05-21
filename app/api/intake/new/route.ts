import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const source: string = body.source ?? "web";
    const prefill: Record<string, unknown> = body.prefill ?? {};

    const sessionId = `sess_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    const initialState = prefill && Object.keys(prefill).length > 0
      ? { contact: prefill }
      : {};

    const { error } = await supabaseAdmin.from("intake_sessions").insert({
      id: sessionId,
      source,
      state: initialState,
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
