import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifySlackSignature, respondToSlashCommand } from "@/lib/slack";
import { formatSqftReply } from "@/lib/attom";
import { lookupPropertyAll } from "@/lib/property-lookup";

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

  // Schedule the ATTOM lookup to run AFTER we send the ack. `after()` tells
  // Vercel's runtime to keep this invocation alive until the callback completes,
  // which a plain `void runLookup(...)` would not — the function would be killed
  // as soon as we returned the response and the awaited ATTOM fetch would never
  // resolve.
  after(runLookup({ address: text, clientId, teamId, userId, channelId, responseUrl }));

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
  const lookup = await lookupPropertyAll(opts.address);

  const status = lookup.ok
    ? (lookup.sqft != null ? "found" : "not_found")
    : lookup.kind;

  // For not-found results, escalate the message if the user has already tried
  // a few times in the last 30 minutes (likely typing variations of the same address).
  let recentNotFoundCount = 0;
  if (status === "not_found" && opts.teamId && opts.userId) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("mark_lookups")
      .select("id", { count: "exact", head: true })
      .eq("slack_team_id", opts.teamId)
      .eq("slack_user_id", opts.userId)
      .eq("status", "not_found")
      .gte("created_at", thirtyMinAgo);
    // This run isn't inserted yet, so add 1 for the current attempt.
    recentNotFoundCount = (count ?? 0) + 1;
  }

  const reply = formatSqftReply(lookup, opts.address, recentNotFoundCount);

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
    status,
    error: lookup.ok ? null : lookup.reason,
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
