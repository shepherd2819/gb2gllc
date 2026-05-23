import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { formatSqftReply } from "@/lib/attom";
import { lookupPropertyAll } from "@/lib/property-lookup";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { address } = await req.json();
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  const result = await lookupPropertyAll(address);
  return NextResponse.json({
    ...result,
    preview: formatSqftReply(result),
  });
}
