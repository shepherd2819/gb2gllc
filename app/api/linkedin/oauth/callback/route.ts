import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeLinkedinCode, getLinkedinUserInfo, memberUrn } from "@/lib/linkedin";
import { logEvent } from "@/lib/logger";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("linkedin_install_state")?.value;

  const mode = stateParam?.split(":")[2] === "admin" ? "admin" : "client";
  const baseLanding = mode === "admin" ? `${ADMIN_URL}/clients` : `${HOME_URL}/connections`;
  const land = (param: string) =>
    mode === "admin" ? `${baseLanding}?linkedin_install=${param}` : `${baseLanding}?linkedin=${param}`;

  if (!code || !stateParam) return NextResponse.redirect(land("missing_code"));
  if (!cookieState || cookieState !== stateParam) return NextResponse.redirect(land("state_mismatch"));

  const [clientId] = stateParam.split(":");
  if (!clientId) return NextResponse.redirect(land("bad_state"));

  let token, userInfo;
  try {
    token = await exchangeLinkedinCode(code);
    userInfo = await getLinkedinUserInfo(token.access_token);
  } catch (err) {
    console.error("[linkedin oauth] exchange failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    await logEvent({ clientId, category: "steward", level: "error", message: `LinkedIn install failed: ${reason}` });
    return NextResponse.redirect(land("exchange_failed"));
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  await supabaseAdmin.from("steward_platform_tokens").upsert(
    {
      client_id: clientId,
      platform: "linkedin",
      token_data: {
        access_token: token.access_token,
        expires_at: expiresAt,
        scope: token.scope ?? null,
        member_urn: memberUrn(userInfo.sub),
        name: userInfo.name ?? null,
        email: userInfo.email ?? null,
        picture: userInfo.picture ?? null,
        installed_at: new Date().toISOString(),
        installed_via: mode,
      },
    },
    { onConflict: "client_id,platform" }
  );

  await logEvent({
    clientId,
    category: "steward",
    level: "info",
    message: `LinkedIn connected: ${userInfo.name ?? userInfo.email ?? userInfo.sub}`,
    metadata: { mode, sub: userInfo.sub },
  });

  const target = mode === "admin" ? `${ADMIN_URL}/clients/${clientId}?linkedin_install=connected` : land("connected");
  const res = NextResponse.redirect(target);
  res.cookies.set("linkedin_install_state", "", {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
