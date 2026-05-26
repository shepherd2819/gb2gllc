// Best-effort homepage scrape. We don't run a headless browser — just fetch the
// HTML, strip scripts/styles, and pull readable text. Truncate so we don't blow
// up Claude's context window.

const MAX_BYTES = 200_000;        // cap network payload
const MAX_TEXT_CHARS = 12_000;    // cap text we send to Claude
const TIMEOUT_MS = 8_000;

export function normalizeUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    // Block private/local addresses for safety
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
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

export type ScrapeResult = {
  ok: true;
  url: string;
  title: string;
  description: string;
  text: string;
  logoUrl: string | null;     // first viable logo we found (resolved to absolute URL)
} | {
  ok: false;
  reason: string;
};

export async function scrapeWebsite(input: string): Promise<ScrapeResult> {
  const url = normalizeUrl(input);
  if (!url) return { ok: false, reason: "That doesn't look like a valid public URL." };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GB2GJune/1.0; +https://gb2gllc.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (e) {
    clearTimeout(t);
    return { ok: false, reason: `Couldn't reach that site (${(e as Error).message})` };
  }
  clearTimeout(t);

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html")) return { ok: false, reason: `That URL returned ${ct || "no content type"} — I can only read HTML pages.` };

  // Read body capped
  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(slice);

  return parseHtml(url, html);
}

function parseHtml(url: string, html: string): ScrapeResult {
  // Strip <script> and <style> blocks entirely
  const s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");

  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1].trim()).slice(0, 200) : "";

  const descMatch = s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    ?? s.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const description = descMatch ? decode(descMatch[1]).slice(0, 500) : "";

  // Extract logo candidates in rough priority order: og:image (richest),
  // apple-touch-icon (usually 180px square), regular favicon (last resort).
  // We resolve relative URLs against the page URL.
  const candidates: string[] = [];
  for (const rx of [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["'](?:apple-touch-icon-precomposed|apple-touch-icon)["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:apple-touch-icon-precomposed|apple-touch-icon)["']/i,
    /<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:icon|shortcut icon)["']/i,
  ]) {
    const m = s.match(rx);
    if (m?.[1]) candidates.push(m[1]);
  }
  let logoUrl: string | null = null;
  for (const c of candidates) {
    try {
      const abs = new URL(decode(c), url).toString();
      logoUrl = abs;
      break;
    } catch {
      // ignore unparseable
    }
  }

  // Extract text from body
  const bodyMatch = s.match(/<body[\s\S]*?<\/body>/i);
  const body = bodyMatch ? bodyMatch[0] : s;
  const text = decode(body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, MAX_TEXT_CHARS);

  if (!text || text.length < 80) {
    return { ok: false, reason: "I couldn't pull readable text from that page — it might be heavily JavaScript-rendered." };
  }
  return { ok: true, url, title, description, text, logoUrl };
}

// Fetch the logo bytes if a URL was extracted. Returns a base64 data URL
// suitable for @react-pdf/renderer's <Image src>, or null on any failure.
// Capped at 1MB so a misbehaving site can't OOM the function.
const LOGO_MAX_BYTES = 1_000_000;
const LOGO_TIMEOUT_MS = 5_000;
export async function fetchLogoAsDataUrl(logoUrl: string): Promise<string | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), LOGO_TIMEOUT_MS);
  try {
    const res = await fetch(logoUrl, { signal: ac.signal, redirect: "follow" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    // Accept anything image-ish; skip SVG since @react-pdf renderToBuffer
    // chokes on SVG-via-Image. PNG/JPG/WEBP work fine.
    if (!ct.startsWith("image/")) return null;
    if (ct.includes("svg")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > LOGO_MAX_BYTES) return null;
    const b64 = Buffer.from(buf).toString("base64");
    return `data:${ct.split(";")[0]};base64,${b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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
