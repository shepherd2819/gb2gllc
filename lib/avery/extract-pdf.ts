import { PDFParse } from "pdf-parse";

const MAX_PDF_CHARS = 50_000;

// pdf-parse v2 exports a PDFParse class. Convert Node Buffer → Uint8Array,
// instantiate, call getText() which returns { text, pages, ... }.
export async function extractPdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docText: string = (result as any)?.text ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages: number = Array.isArray((result as any)?.pages) ? (result as any).pages.length : 0;
    return {
      text: docText.trim().slice(0, MAX_PDF_CHARS),
      pages,
    };
  } finally {
    await parser.destroy();
  }
}
