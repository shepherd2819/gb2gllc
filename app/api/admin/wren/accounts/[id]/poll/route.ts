import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { pollAccount } from "@/lib/wren/poll";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const result = await pollAccount(id);
  return NextResponse.json({ ok: true, result });
}
