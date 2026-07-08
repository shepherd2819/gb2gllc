// app/api/admin/analytics/oauth/callback/route.ts
//
// STATIC redirect URI — no [id]/[sourceId] in the path. This exact path is
// what SourceOAuthProvider.redirectUrl (lib/analytics/oauth-core.ts)
// registers with every MCP authorization server via Dynamic Client
// Registration, so it cannot be parameterized per client/source. Tenant +
// source scoping instead travels in the signed `state` param (oauth-core.ts
// signState/validateState, HMAC-bound so it can't be forged or misrouted —
// this is the CSRF defense for the whole flow).
//
// Deviation from the brief: `state`/`code` are read via
// req.nextUrl.searchParams (synchronous), not an async `searchParams`
// Promise — verified against this Next.js version's actual route-handler
// convention (every existing route.ts in this repo, e.g.
// app/api/iris/oauth/callback/route.ts and app/api/meta/oauth/callback/
// route.ts, reads req.nextUrl.searchParams.get(...) synchronously; only
// dynamic route `params` and page-component `searchParams` are Promises
// here — see AGENTS.md's directive to verify against the actual API rather
// than assume).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { completeConnect, validateState } from "@/lib/analytics/oauth";

export const dynamic = "force-dynamic";
// completeConnect exchanges the code for tokens (a token-endpoint round
// trip); same rationale as the sibling sources/[sourceId]/test/route.ts's
// maxDuration.
export const maxDuration = 60;

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error");

  const stateResult = validateState(state);
  if (!stateResult.ok) {
    // No trustworthy clientId to land on — state itself failed validation
    // (missing / tampered / expired). Never leak the code or error detail.
    return NextResponse.redirect(`${ADMIN_URL}/clients`, { status: 302 });
  }
  const { clientId, sourceId } = stateResult;
  const land = (flash: "connected" | "error") =>
    NextResponse.redirect(`${ADMIN_URL}/clients/${clientId}?analytics=${flash}`, { status: 302 });

  // Authorization server declined/aborted, or no code came back — either
  // way there's nothing to exchange.
  if (oauthError || !code) return land("error");

  const result = await completeConnect(sourceId, clientId, code);
  return land(result.ok ? "connected" : "error");
}
