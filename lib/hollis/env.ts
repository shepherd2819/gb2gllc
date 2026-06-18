// Central source for Hollis's Retell credential. Lives in a Vercel encrypted
// env var — never in the database (mirrors lib/nora/env.ts).
//
// Retell verifies webhook signatures with the API KEY itself (the key that has
// the webhook badge) — there is no separate webhook secret. The same key
// authenticates REST calls (provisioning numbers, etc.).

export type HollisSecretsResult =
  | { ok: true; retellApiKey: string }
  | { ok: false; missing: "RETELL_API_KEY"[] };

export function getHollisSecrets(): HollisSecretsResult {
  const key = process.env.RETELL_API_KEY?.trim();
  if (!key) return { ok: false, missing: ["RETELL_API_KEY"] };
  return { ok: true, retellApiKey: key };
}

export function hasHollisSecrets(): boolean {
  return getHollisSecrets().ok;
}
