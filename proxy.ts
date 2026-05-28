import { NextRequest, NextResponse, NextFetchEvent } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

const MIDDLEWARE_AUTH = {
  enabled: false,
  unauthenticatedPaths: [] as string[],
};

const homeAuthkit = authkitMiddleware({ redirectUri: `${HOME_URL}/auth/callback`, middlewareAuth: MIDDLEWARE_AUTH });
const adminAuthkit = authkitMiddleware({ redirectUri: `${ADMIN_URL}/auth/callback`, middlewareAuth: MIDDLEWARE_AUTH });

export default function proxy(req: NextRequest, evt: NextFetchEvent) {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  const isAdmin = /^(www\.)?admin\.gb2gllc\.com(:\d+)?$/.test(host);

  // root redirects
  if (/^(www\.)?home\.gb2gllc\.com(:\d+)?$/.test(host) && pathname === "/") {
    return NextResponse.redirect(new URL("/welcome", req.url));
  }
  if (isAdmin && pathname === "/") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  return isAdmin ? adminAuthkit(req, evt) : homeAuthkit(req, evt);
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
    "/submissions/:path*",
    "/support/:path*",
    "/billing/:path*",
    "/agents/:path*",
    "/welcome",
    "/auth/:path*",
  ],
};
