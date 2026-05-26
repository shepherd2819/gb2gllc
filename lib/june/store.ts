import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export function extractIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}

export type AttemptRow = {
  id: string;
  ip: string;
  conversation: { role: "user" | "assistant"; content: string }[];
  website_url: string | null;
  scraped_text: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audit_data: any;
  pdf_generated_at: string | null;
  email: string | null;
  email_sent_at: string | null;
  status: "chatting" | "auditing" | "audit_ready" | "emailed" | "blocked" | "errored";
  error: string | null;
  resend_id: string | null;
};

export async function getOrCreateAttempt(ip: string, userAgent: string | null): Promise<AttemptRow> {
  const { data: existing } = await supabaseAdmin
    .from("june_demo_attempts")
    .select("*")
    .eq("ip", ip)
    .maybeSingle();
  if (existing) return existing as AttemptRow;

  const { data: created, error } = await supabaseAdmin
    .from("june_demo_attempts")
    .insert({ ip, user_agent: userAgent, conversation: [], status: "chatting" })
    .select("*")
    .single();
  if (error) throw new Error(`attempt insert: ${error.message}`);
  return created as AttemptRow;
}

export async function updateAttempt(id: string, patch: Partial<Omit<AttemptRow, "id" | "ip">>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("june_demo_attempts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`attempt update: ${error.message}`);
}

export function isRateLimited(row: AttemptRow): boolean {
  return row.status === "emailed" || row.status === "blocked" || row.email_sent_at !== null;
}
