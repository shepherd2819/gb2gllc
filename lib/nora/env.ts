// Central source for Nora's Stripe credentials.
//
// Both live in Vercel encrypted env vars — never in the database. A DB
// leak alone cannot expose Stripe credentials.
//
// Single-account by design: one Stripe account per GB2G deploy. If we
// ever need multi-account, we'll switch to envelope encryption (per-row
// AES-256-GCM with a master key in env) rather than plaintext-in-DB.

export type SecretsOk = {
  ok: true;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
};

export type SecretsErr = {
  ok: false;
  missing: ("NORA_STRIPE_SECRET_KEY" | "NORA_STRIPE_WEBHOOK_SECRET")[];
};

export type NoraSecretsResult = SecretsOk | SecretsErr;

export function getNoraSecrets(): NoraSecretsResult {
  const sk = process.env.NORA_STRIPE_SECRET_KEY?.trim();
  const wh = process.env.NORA_STRIPE_WEBHOOK_SECRET?.trim();
  const missing: SecretsErr["missing"] = [];
  if (!sk) missing.push("NORA_STRIPE_SECRET_KEY");
  if (!wh) missing.push("NORA_STRIPE_WEBHOOK_SECRET");
  if (missing.length) return { ok: false, missing };
  return { ok: true, stripeSecretKey: sk!, stripeWebhookSecret: wh! };
}

export function getStripeSecretOrThrow(): string {
  const r = getNoraSecrets();
  if (!r.ok) throw new Error(`Nora secrets missing in env: ${r.missing.join(", ")}`);
  return r.stripeSecretKey;
}

export function hasNoraSecrets(): boolean {
  return getNoraSecrets().ok;
}
