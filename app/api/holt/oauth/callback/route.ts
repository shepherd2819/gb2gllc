import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeGoogleCode, getGoogleUserInfo } from "@/lib/gmail";
import { getCalendarTimezone } from "@/lib/holt/calendar";
import { logEvent } from "@/lib/logger";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";
const HOLT_REDIRECT_URI = `${ADMIN_URL}/api/holt/oauth/callback`;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("holt_install_state")?.value;
  const land = (p: string) => NextResponse.redirect(`${ADMIN_URL}/agents/holt?holt_install=${p}`);

  if (!code || !stateParam) return land("missing_code");
  if (!cookieState || cookieState !== stateParam) return land("state_mismatch");

  const [workosUserId] = stateParam.split(":");
  if (!workosUserId) return land("bad_state");

  let token, userInfo, tz: string | null = null;
  try {
    token = await exchangeGoogleCode({ code, redirectUri: HOLT_REDIRECT_URI });
    if (!token.refresh_token) return land("no_refresh_token");
    [userInfo, tz] = await Promise.all([
      getGoogleUserInfo(token.access_token),
      getCalendarTimezone(token.access_token).catch(() => null),
    ]);
  } catch (err) {
    console.error("[holt oauth] exchange failed", err);
    await logEvent({ category: "holt", level: "error", message: `Holt OAuth failed: ${err instanceof Error ? err.message : String(err)}` });
    return land("exchange_failed");
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  const { error } = await supabaseAdmin.from("holt_accounts").upsert(
    {
      workos_user_id: workosUserId,
      email_address: userInfo.email.toLowerCase(),
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expires_at: expiresAt,
      scope: token.scope,
      timezone: tz,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workos_user_id,email_address" }
  );

  if (error) {
    console.error("[holt oauth] upsert failed", error);
    return land("save_failed");
  }

  await logEvent({
    category: "holt", level: "info",
    message: `Holt calendar connected: ${userInfo.email} (tz: ${tz ?? "unknown"})`,
    metadata: { sub: userInfo.sub, tz },
  });

  const res = NextResponse.redirect(`${ADMIN_URL}/agents/holt?holt_install=connected`);
  res.cookies.set("holt_install_state", "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/", domain: ".gb2gllc.com" });
  return res;
}
