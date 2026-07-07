import { supabaseAdmin } from "./supabase";

type Level = "info" | "warn" | "error";
type Category = "herald" | "intake" | "steward" | "system" | "iris" | "wren" | "holt" | "nora" | "vera" | "hollis" | "onboarding" | "analytics";

export async function logEvent(opts: {
  clientId?: string | null;
  sessionId?: string | null;
  level?: Level;
  category: Category;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await supabaseAdmin.from("client_logs").insert({
      client_id: opts.clientId ?? null,
      session_id: opts.sessionId ?? null,
      level: opts.level ?? "info",
      category: opts.category,
      message: opts.message,
      metadata: opts.metadata ?? null,
    });
  } catch {
    // Never throw from logger
    console.error("[logger] failed to write log:", opts.message);
  }
}
