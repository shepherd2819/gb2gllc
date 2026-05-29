import { randomBytes } from "node:crypto";

export type TokenContractRow = {
  status: "draft" | "sent" | "signed" | "voided" | "expired";
  expires_at: string;
};

export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isTokenSignable(row: TokenContractRow): boolean {
  if (row.status !== "sent") return false;
  return Date.parse(row.expires_at) > Date.now();
}

// Loads a row by token using supabaseAdmin. Returns null if not found.
// Caller uses isTokenSignable() to gate access.
export async function loadContractByToken(token: string) {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("contracts")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return data;
}
