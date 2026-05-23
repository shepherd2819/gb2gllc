import { NextResponse } from "next/server";
import { sendDigestForClient } from "@/lib/herald-digest";
import { requireAdmin } from "@/lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { id } = await params;
    const result = await sendDigestForClient(id, { force: true });
    return NextResponse.json(result);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[herald test-digest] unhandled error:", err);
    return NextResponse.json({ status: "failed", reason, step: "handler" }, { status: 500 });
  }
}
