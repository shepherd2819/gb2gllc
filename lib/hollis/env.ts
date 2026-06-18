// Central source for Hollis's Retell credentials. Both live in Vercel
// encrypted env vars — never in the database (mirrors lib/nora/env.ts).

export type HollisSecretsResult =
  | { ok: true; retellApiKey: string; retellWebhookSecret: string }
  | { ok: false; missing: ("RETELL_API_KEY" | "RETELL_WEBHOOK_SECRET")[] };

export function getHollisSecrets(): HollisSecretsResult {
  const key = process.env.RETELL_API_KEY?.trim();
  const wh = process.env.RETELL_WEBHOOK_SECRET?.trim();
  const missing: ("RETELL_API_KEY" | "RETELL_WEBHOOK_SECRET")[] = [];
  if (!key) missing.push("RETELL_API_KEY");
  if (!wh) missing.push("RETELL_WEBHOOK_SECRET");
  if (missing.length) return { ok: false, missing };
  return { ok: true, retellApiKey: key!, retellWebhookSecret: wh! };
}

export function hasHollisSecrets(): boolean {
  return getHollisSecrets().ok;
}
