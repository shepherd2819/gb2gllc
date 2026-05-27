import { extractText } from "unpdf";

const MAX_PDF_CHARS = 50_000;

// unpdf is a serverless-friendly wrapper around pdfjs-dist — no canvas /
// DOM polyfill dependencies, so it runs on Vercel functions out of the box.
// (pdf-parse v2 pulled in DOMMatrix / ImageData / Path2D requirements which
// crashed at module-import time on Vercel's Node runtime.)
export async function extractPdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const result = await extractText(new Uint8Array(buf), { mergePages: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawText: unknown = (result as any).text;
  const totalPages: number = (result as { totalPages?: number }).totalPages ?? 0;
  const merged = typeof rawText === "string"
    ? rawText
    : Array.isArray(rawText) ? rawText.join("\n\n") : "";
  return {
    text: merged.trim().slice(0, MAX_PDF_CHARS),
    pages: totalPages ?? 0,
  };
}
