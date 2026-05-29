import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { refreshSession } from "@workos-inc/authkit-nextjs";
import { googleInstallUrl } from "@/lib/gmail";
import { IRIS_REDIRECT_URI } from "@/lib/iris/oauth-config";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

// GET /api/iris/oauth/start
// Admin clicks "Connect inbox" → we generate a state nonce, set a cookie,
// and redirect to Google. State format: `<workos-user-id>:<nonce>`.
//
// We use refreshSession (not withAuth) because withAuth requires the AuthKit
// middleware matcher to cover this route — proxy.ts only matches /agents,
// /admin, /auth, etc., not /api/*. refreshSession works in any handler.
export async function GET(_req: NextRequest) {
  let user;
  try { user = (await refreshSession({ ensureSignedIn: false })).user; }
  catch { user = null; }
  if (!user) return NextResponse.redirect(new URL("/auth/signin?next=/agents/iris", _req.url));
  if (user.email !== ADMIN_EMAIL) return NextResponse.redirect(new URL("/auth/no-account", _req.url));

  const nonce = randomBytes(16).toString("hex");
  const state = `${user.id}:${nonce}`;
  const url = googleInstallUrl({ state, redirectUri: IRIS_REDIRECT_URI });

  const res = NextResponse.redirect(url);
  res.cookies.set("iris_install_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
