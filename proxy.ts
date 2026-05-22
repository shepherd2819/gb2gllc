import { NextRequest, NextResponse, NextFetchEvent } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";

const authkit = authkitMiddleware({ redirectUri: `${HOME_URL}/auth/callback` });

export default function proxy(req: NextRequest, evt: NextFetchEvent) {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  // home.gb2gllc.com (with or without www) / → /dashboard
  if (/^(www\.)?home\.gb2gllc\.com(:\d+)?$/.test(host) && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  // admin.gb2gllc.com (with or without www) / → /admin
  if (/^(www\.)?admin\.gb2gllc\.com(:\d+)?$/.test(host) && pathname === "/") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  return authkit(req, evt);
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/connections/:path*",
    "/tickets/:path*",
    "/account/:path*",
    "/admin/:path*",
    "/clients/:path*",
    "/billing/:path*",
    "/auth/:path*",
  ],
};
