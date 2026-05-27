import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

// POST: bulk lead upload. Body can be either:
//   { csv: string }    — raw CSV with header row
//   { leads: [{ name?, email?, company?, website?, notes? }] }
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const body = await req.json();

  let rawLeads: Array<{ name?: string; email?: string; company?: string; website?: string; notes?: string }> = [];

  if (Array.isArray(body.leads)) {
    rawLeads = body.leads;
  } else if (typeof body.csv === "string") {
    rawLeads = parseCsv(body.csv);
  } else {
    return NextResponse.json({ error: "Provide leads[] or csv string" }, { status: 400 });
  }

  const clean = rawLeads
    .map((l) => ({
      campaign_id: id,
      name:    l.name?.trim()    || null,
      email:   l.email?.trim()   || null,
      company: l.company?.trim() || null,
      website: l.website?.trim() || null,
      notes:   l.notes?.trim()   || null,
      status: "pending" as const,
    }))
    // Need at least one of email/website to be useful
    .filter((l) => l.email || l.website);

  if (clean.length === 0) return NextResponse.json({ error: "No usable leads (need email or website per row)" }, { status: 400 });

  const { data, error } = await supabaseAdmin.from("avery_leads").insert(clean).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, inserted: data?.length ?? 0 });
}

// Minimal CSV parser: handles quoted fields with commas, no fancy escaping.
function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, j) => { row[h] = (cells[j] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
