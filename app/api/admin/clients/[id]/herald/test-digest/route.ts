import { NextResponse } from "next/server";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { sendDigestForClient } from "@/lib/herald-digest";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { user } = await refreshSession({ ensureSignedIn: false });
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await sendDigestForClient(id, { force: true });
  return NextResponse.json(result);
}
