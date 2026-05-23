import { NextResponse } from "next/server";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { sendDigestForClient } from "@/lib/herald-digest";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const { user } = await refreshSession({ ensureSignedIn: false });
    if (!user) {
      return NextResponse.json({ status: "failed", reason: "Not authenticated", step: "auth" }, { status: 401 });
    }
    if (user.email !== ADMIN_EMAIL) {
      return NextResponse.json(
        { status: "failed", reason: `Email ${user.email} is not the admin`, step: "auth" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const result = await sendDigestForClient(id, { force: true });
    return NextResponse.json(result);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[herald test-digest] unhandled error:", err);
    return NextResponse.json({ status: "failed", reason, step: "handler" }, { status: 500 });
  }
}
