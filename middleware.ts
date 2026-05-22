import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  // Redirect unauthenticated users to WorkOS sign-in
  redirectUri: `${process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com"}/auth/callback`,
});

export const config = {
  matcher: [
    // Run on portal pages only — skip static files, API routes, public pages
    "/dashboard/:path*",
    "/connections/:path*",
    "/tickets/:path*",
    "/account/:path*",
    "/auth/:path*",
  ],
};
