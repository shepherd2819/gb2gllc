import { NextResponse } from "next/server";
import { refreshSession } from "@workos-inc/authkit-nextjs";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export type AdminGuardResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; response: NextResponse };

/**
 * Guard for /api/admin/* route handlers. Verifies the request is from the
 * configured admin email. Returns either { ok: true, user } or a NextResponse
 * the handler should return directly.
 *
 * Usage:
 *   const guard = await requireAdmin();
 *   if (!guard.ok) return guard.response;
 *   // ... proceed
 */
export async function requireAdmin(): Promise<AdminGuardResult> {
  try {
    const { user } = await refreshSession({ ensureSignedIn: false });
    if (!user) {
      return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    if (user.email !== ADMIN_EMAIL) {
      return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { ok: true, user: { id: user.id, email: user.email } };
  } catch (err) {
    console.error("[requireAdmin] session check failed", err);
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
}
