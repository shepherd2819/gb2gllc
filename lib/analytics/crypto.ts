// lib/analytics/crypto.ts
// AES-256-GCM encryption for per-client data-source credentials at rest
// (client_data_sources.secret_enc). Blob format: v1:<iv>:<tag>:<ct>, each
// segment base64. Keyed by ANALYTICS_SECRET_KEY (base64, exactly 32 bytes;
// generate with: openssl rand -base64 32). A DB leak alone exposes nothing.
// Decryption happens only server-side at adapter call time — never in UI.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;

function loadKey(): Buffer {
  const raw = process.env.ANALYTICS_SECRET_KEY;
  if (!raw) {
    throw new Error(
      "ANALYTICS_SECRET_KEY is not set (generate with: openssl rand -base64 32)",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ANALYTICS_SECRET_KEY must decode to 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const key = loadKey();
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("decryptSecret: unrecognized blob format (expected v1:<iv>:<tag>:<ct>)");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// For the admin "configured ✓ ····last4" display — call BEFORE encrypting.
export function secretLast4(plaintext: string): string {
  return plaintext.slice(-4);
}
