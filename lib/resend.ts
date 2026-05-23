import { Resend } from "resend";

let _client: Resend | null = null;
export function resend() {
  if (!_client) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not set");
    _client = new Resend(key);
  }
  return _client;
}

export const DEFAULT_FROM = process.env.RESEND_FROM ?? "GB2G <herald@gb2gllc.com>";
