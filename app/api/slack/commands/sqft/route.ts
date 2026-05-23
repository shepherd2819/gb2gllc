import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifySlackSignature, respondToSlashCommand } from "@/lib/slack";
import { lookupProperty, formatSqftReply } from "@/lib/attom";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Slack expects a response within 3 seconds. We immediately ack with an
// "in_channel" placeholder, then do the ATTOM lookup async and POST the
// real answer to response_url.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  const verify = verifySlackSignature({ rawBody, timestamp, signature });
  if (!verify.ok) {
    console.warn("[slack /sqft] signature rejected:", verify.reason);
    return NextResponse.json({ error: verify.reason }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const teamId = params.get("team_id") ?? "";
  const userId = params.get("user_id") ?? "";
  const channelId = params.get("channel_id") ?? "";
  const text = (params.get("text") ?? "").trim();
  const responseUrl = params.get("response_url") ?? "";

  // Map Slack workspace → our client
  const { data: token } = await supabaseAdmin
    .from("steward_platform_tokens")
    .select("client_id, token_data")
    .eq("platform", "slack")
    .filter("token_data->>team_id", "eq", teamId)
    .single();

  const clientId = token?.client_id ?? null;

  if (!text) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Usage: `/sqft <full street address>` — e.g. `/sqft 4529 Winona Ct, Denver CO 80212`",
    });
  }

  // Kick off async work; ack immediately
  void runLookup({ address: text, clientId, teamId, userId, channelId, responseUrl });

  return NextResponse.json({
    response_type: "in_channel",
    text: `🔍 Looking up *${escapeMarkdown(text)}*…`,
  });
}

async function runLookup(opts: {
  address: string;
  clientId: string | null;
  teamId: string;
  userId: string;
  channelId: string;
  responseUrl: string;
}) {
  const lookup = await lookupProperty(opts.address);
  const reply = formatSqftReply(lookup);

  await supabaseAdmin.from("mark_lookups").insert({
    client_id: opts.clientId,
    slack_team_id: opts.teamId,
    slack_user_id: opts.userId,
    slack_channel_id: opts.channelId,
    input_address: opts.address,
    normalized: lookup.ok ? lookup.normalizedAddress : null,
    sqft: lookup.ok ? lookup.sqft : null,
    beds: lookup.ok ? lookup.beds : null,
    baths: lookup.ok ? lookup.baths : null,
    year_built: lookup.ok ? lookup.yearBuilt : null,
    property_type: lookup.ok ? lookup.propertyType : null,
    status: lookup.ok ? (lookup.sqft != null ? "found" : "not_found") : "error",
    error: lookup.ok ? null : lookup.error,
    raw: lookup as unknown as object,
  });

  if (opts.responseUrl) {
    await respondToSlashCommand(opts.responseUrl, {
      text: reply,
      response_type: "in_channel",
      replace_original: true,
    });
  }
}

function escapeMarkdown(s: string) {
  return s.replace(/[*_~`]/g, "\\$&");
}
