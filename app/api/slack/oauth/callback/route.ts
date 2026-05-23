import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeSlackCode } from "@/lib/slack";
import { logEvent } from "@/lib/logger";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("slack_install_state")?.value;

  // Determine landing page from the state's mode field
  const mode = stateParam?.split(":")[2] === "admin" ? "admin" : "client";
  const baseLanding = mode === "admin" ? `${ADMIN_URL}/clients` : `${HOME_URL}/connections`;
  const land = (param: string) =>
    mode === "admin" ? `${baseLanding}?slack_install=${param}` : `${baseLanding}?slack=${param}`;

  if (!code || !stateParam) return NextResponse.redirect(land("missing_code"));
  if (!cookieState || cookieState !== stateParam) return NextResponse.redirect(land("state_mismatch"));

  const [clientId] = stateParam.split(":");
  if (!clientId) return NextResponse.redirect(land("bad_state"));

  const oauth = await exchangeSlackCode(code);
  if (!oauth.ok || !oauth.access_token || !oauth.team?.id) {
    console.error("[slack oauth] exchange failed", oauth);
    await logEvent({
      clientId,
      category: "steward",
      level: "error",
      message: `Slack install failed: ${oauth.error ?? "unknown"}`,
    });
    return NextResponse.redirect(land("exchange_failed"));
  }

  await supabaseAdmin.from("steward_platform_tokens").upsert(
    {
      client_id: clientId,
      platform: "slack",
      token_data: {
        access_token: oauth.access_token,
        bot_user_id: oauth.bot_user_id,
        team_id: oauth.team.id,
        team_name: oauth.team.name,
        scope: oauth.scope,
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
    message: `Slack workspace "${oauth.team.name}" connected (${mode} install)`,
    metadata: { team_id: oauth.team.id, bot_user_id: oauth.bot_user_id, mode },
  });

  const target = mode === "admin" ? `${ADMIN_URL}/clients/${clientId}?slack_install=connected` : land("connected");
  const res = NextResponse.redirect(target);
  res.cookies.set("slack_install_state", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
    domain: ".gb2gllc.com",
  });
  return res;
}
