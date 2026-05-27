import { anthropic } from "@/lib/anthropic";
import { extractPdfText } from "./extract-pdf";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4_000;

export type ExtractedLead = {
  name: string;
  email: string;
  company: string;
  website: string;
  notes: string;
};

// Pull the PDF text, ask Claude to find every distinct lead in it and return
// structured JSON. PDFs can be tables, paragraphs, business-card scans, etc.
// — we let the model handle the variation.
export async function extractLeadsFromPdf(buf: Buffer): Promise<ExtractedLead[]> {
  const { text } = await extractPdfText(buf);
  if (!text || text.length < 30) return [];

  const system = `You are a contact-list parser. The user will paste raw text extracted from a PDF that contains business contacts (a lead list). Your job is to identify every distinct contact in the text and return them as structured JSON.

Output ONLY a single valid JSON object with this exact shape (no preamble, no markdown fences):
{
  "leads": [
    {
      "name":    string,   // person's full name (empty string if unknown)
      "email":   string,   // email address (empty string if unknown)
      "company": string,   // company / organization name (empty string if unknown)
      "website": string,   // website URL — include https:// if missing (empty string if unknown)
      "notes":   string    // any extra context from the PDF about this lead (role, location, source, intro line, etc.). Empty string if none.
    }
  ]
}

Rules:
- Extract ONLY distinct real contacts. Skip header text, page numbers, footers, "Page 1 of 5", and any obviously non-contact noise.
- A row qualifies as a lead if it has AT LEAST one of: email OR website. If a row has only a name and no way to reach them, skip it.
- If a company appears multiple times with different people, return each person as a separate lead (with the same company filled in).
- If the PDF is a table, infer the column meanings from headers. Common headers: Name / Contact, Email, Company / Organization, Website / URL / Site, Notes / Source / Role.
- For email: lowercase the domain. For website: prepend https:// if missing. Don't invent domains — leave empty if not in the source.
- Be conservative with "notes": only put text the source clearly attached to that contact (e.g. "Marketing director", "introduced by Sarah", "based in Austin"). Don't invent context.
- If there are duplicate emails, return only the first occurrence.
- Maximum 200 leads per call (truncate if more).`;

  const userMessage = `PDF text:
"""
${text.slice(0, 40_000)}
"""

Return the JSON object now.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();
  const jsonStr = raw.startsWith("```") ? raw.replace(/^```(?:json)?/, "").replace(/```$/, "").trim() : raw;

  let parsed: { leads?: Partial<ExtractedLead>[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude returned non-JSON lead list: ${raw.slice(0, 200)}`);
  }

  const arr = Array.isArray(parsed.leads) ? parsed.leads : [];
  // Defensive normalization + final usable-lead filter
  return arr
    .map((l) => ({
      name:    (l.name    ?? "").toString().trim(),
      email:   (l.email   ?? "").toString().trim().toLowerCase(),
      company: (l.company ?? "").toString().trim(),
      website: (l.website ?? "").toString().trim(),
      notes:   (l.notes   ?? "").toString().trim(),
    }))
    .filter((l) => l.email || l.website);
}
