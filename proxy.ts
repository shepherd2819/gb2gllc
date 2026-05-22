import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

export default authkitMiddleware({
  // Redirect unauthenticated users to WorkOS sign-in
  redirectUri: `${process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com"}/auth/callback`,
});

export const config = {
  matcher: [
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
