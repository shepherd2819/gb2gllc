// app/api/admin/sawyer/clients/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { searchClients } from "@/lib/sawyer/context";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ clients: await searchClients(q) });
}
