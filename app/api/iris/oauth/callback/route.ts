import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeGoogleCode, getGoogleUserInfo, getGmailProfile, getGmailSendAs } from "@/lib/gmail";
import { logEvent } from "@/lib/logger";
import { IRIS_REDIRECT_URI } from "@/lib/iris/oauth-config";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("iris_install_state")?.value;
  const land = (p: string) => NextResponse.redirect(`${ADMIN_URL}/agents/iris?iris_install=${p}`);

  if (!code || !stateParam) return land("missing_code");
  if (!cookieState || cookieState !== stateParam) return land("state_mismatch");

  const [workosUserId] = stateParam.split(":");
  if (!workosUserId) return land("bad_state");

  let token, userInfo, profile, aliases: string[] = [];
  try {
    token = await exchangeGoogleCode({ code, redirectUri: IRIS_REDIRECT_URI });
    if (!token.refresh_token) {
      // Without a refresh_token we can't poll long-term. Force user to re-consent.
      return land("no_refresh_token");
    }
    [userInfo, profile, aliases] = await Promise.all([
      getGoogleUserInfo(token.access_token),
      getGmailProfile(token.access_token),
      getGmailSendAs(token.access_token).catch(() => []),
    ]);
  } catch (err) {
    console.error("[iris oauth] exchange failed", err);
    await logEvent({ category: "iris", level: "error", message: `Iris OAuth failed: ${err instanceof Error ? err.message : String(err)}` });
    return land("exchange_failed");
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  const { error } = await supabaseAdmin.from("iris_inbox_accounts").upsert(
    {
      workos_user_id: workosUserId,
      provider: "gmail",
      email_address: profile.emailAddress.toLowerCase(),
      aliases: aliases.filter((a) => a.toLowerCase() !== profile.emailAddress.toLowerCase()),
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expires_at: expiresAt,
      scope: token.scope,
      history_id: profile.historyId,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workos_user_id,email_address" }
  );

  if (error) {
    console.error("[iris oauth] upsert failed", error);
    return land("save_failed");
  }

  await logEvent({
    category: "iris",
    level: "info",
    message: `Iris inbox connected: ${profile.emailAddress} (${aliases.length} aliases)`,
    metadata: { sub: userInfo.sub, aliases },
  });

  const res = NextResponse.redirect(`${ADMIN_URL}/agents/iris?iris_install=connected`);
  res.cookies.set("iris_install_state", "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/", domain: ".gb2gllc.com" });
  return res;
}
