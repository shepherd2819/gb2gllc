import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { runHoltForAccount } from "@/lib/holt/orchestrate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const result = await runHoltForAccount(id, { force: true });
  return NextResponse.json({ ok: true, result });
}
