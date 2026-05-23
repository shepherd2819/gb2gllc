import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeSlackCode } from "@/lib/slack";
import { logEvent } from "@/lib/logger";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("slack_install_state")?.value;

  if (!code || !stateParam) {
    return NextResponse.redirect(`${HOME_URL}/connections?slack=missing_code`);
  }
  if (!cookieState || cookieState !== stateParam) {
    return NextResponse.redirect(`${HOME_URL}/connections?slack=state_mismatch`);
  }

  const [clientId] = stateParam.split(":");
  if (!clientId) return NextResponse.redirect(`${HOME_URL}/connections?slack=bad_state`);

  const oauth = await exchangeSlackCode(code);
  if (!oauth.ok || !oauth.access_token || !oauth.team?.id) {
    console.error("[slack oauth] exchange failed", oauth);
    await logEvent({
      clientId,
      category: "steward",
      level: "error",
      message: `Slack install failed: ${oauth.error ?? "unknown"}`,
    });
    return NextResponse.redirect(`${HOME_URL}/connections?slack=exchange_failed`);
  }

  // Store the workspace token under the client's Slack platform binding.
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
      },
    },
    { onConflict: "client_id,platform" }
  );

  await logEvent({
    clientId,
    category: "steward",
    level: "info",
    message: `Slack workspace "${oauth.team.name}" connected`,
    metadata: { team_id: oauth.team.id, bot_user_id: oauth.bot_user_id },
  });

  const res = NextResponse.redirect(`${HOME_URL}/connections?slack=connected`);
  res.cookies.delete("slack_install_state");
  return res;
}
