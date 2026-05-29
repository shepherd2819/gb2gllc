// Shared Wren OAuth configuration.
//
// WREN_REDIRECT_URI is read in two places — start/route.ts (passed to
// googleInstallUrl as redirectUri) and callback/route.ts (passed to
// exchangeGoogleCode). Both must use the same value or Google rejects the
// token exchange with redirect_uri_mismatch, so it lives in one place.

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
export const WREN_REDIRECT_URI = `${ADMIN_URL}/api/wren/oauth/callback`;
