import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { googleInstallUrl } from "@/lib/iris/google";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

// GET /api/iris/oauth/start
// Admin clicks "Connect inbox" → we generate a state nonce, set a cookie,
// and redirect to Google. State format: `<workos-user-id>:<nonce>`.
export async function GET(_req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/agents/iris", _req.url));
  if (user.email !== ADMIN_EMAIL) return NextResponse.redirect(new URL("/auth/no-account", _req.url));

  const nonce = randomBytes(16).toString("hex");
  const state = `${user.id}:${nonce}`;
  const url = googleInstallUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set("iris_install_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
