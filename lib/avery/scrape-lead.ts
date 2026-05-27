const MAX_BYTES = 250_000;
const MAX_TEXT_CHARS = 8_000;
const TIMEOUT_MS = 8_000;

export type LeadEnrichment = {
  scraped_text: string;
  page_title: string;
  page_description: string;
  contact_form_url: string | null;
  resolved_url: string;
  scraped_at: string;
};

export function normalizeUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function enrichLead(websiteUrl: string): Promise<LeadEnrichment | null> {
  const url = normalizeUrl(websiteUrl);
  if (!url) return null;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GB2GAvery/1.0; +https://gb2gllc.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch {
    clearTimeout(t);
    return null;
  }
  clearTimeout(t);

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html")) return null;

  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(slice);

  const s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");

  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const page_title = titleMatch ? decode(titleMatch[1].trim()).slice(0, 200) : "";

  const descMatch = s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    ?? s.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const page_description = descMatch ? decode(descMatch[1]).slice(0, 500) : "";

  // Look for an obvious contact-form URL — first match wins.
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const contactPatterns = [
    /\/contact(?:[-_/]us)?\/?/i,
    /\/get-in-touch\/?/i,
    /\/get-a-quote\/?/i,
    /\/work[-_ ]with[-_ ]us\/?/i,
    /\/let'?s[-_ ]talk\/?/i,
    /\/inquir(?:e|y)\/?/i,
  ];
  let contact_form_url: string | null = null;
  let m;
  while ((m = linkRegex.exec(s)) !== null) {
    const href = m[1];
    const label = decode((m[2] || "").replace(/<[^>]+>/g, " ").trim()).toLowerCase();
    const labelMatch = /\bcontact\b|\bget in touch\b|\bget a quote\b|\bwork with us\b|\binqu(?:ire|iry)\b|\blet'?s talk\b/.test(label);
    const pathMatch = contactPatterns.some((rx) => rx.test(href));
    if (labelMatch || pathMatch) {
      try {
        contact_form_url = new URL(href, url).toString();
        break;
      } catch { /* ignore unparseable */ }
    }
  }

  const bodyMatch = s.match(/<body[\s\S]*?<\/body>/i);
  const body = bodyMatch ? bodyMatch[0] : s;
  const scraped_text = decode(body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, MAX_TEXT_CHARS);

  return {
    scraped_text,
    page_title,
    page_description,
    contact_form_url,
    resolved_url: url,
    scraped_at: new Date().toISOString(),
  };
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
