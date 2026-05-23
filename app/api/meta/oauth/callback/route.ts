import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { exchangeMetaCode, listUserPages, subscribePageToApp, getInstagramUsername } from "@/lib/meta";
import { logEvent } from "@/lib/logger";

const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL ?? "https://home.gb2gllc.com";
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.gb2gllc.com";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("meta_install_state")?.value;

  const mode = stateParam?.split(":")[2] === "admin" ? "admin" : "client";
  const baseLanding = mode === "admin" ? `${ADMIN_URL}/clients` : `${HOME_URL}/connections`;
  const land = (param: string) =>
    mode === "admin" ? `${baseLanding}?meta_install=${param}` : `${baseLanding}?meta=${param}`;

  if (!code || !stateParam) return NextResponse.redirect(land("missing_code"));
  if (!cookieState || cookieState !== stateParam) return NextResponse.redirect(land("state_mismatch"));

  const [clientId] = stateParam.split(":");
  if (!clientId) return NextResponse.redirect(land("bad_state"));

  let userToken: string;
  try {
    const tok = await exchangeMetaCode(code);
    userToken = tok.access_token;
  } catch (err) {
    console.error("[meta oauth] token exchange failed", err);
    await logEvent({ clientId, category: "steward", level: "error", message: `Meta install failed: ${err instanceof Error ? err.message : String(err)}` });
    return NextResponse.redirect(land("exchange_failed"));
  }

  let pages;
  try {
    pages = await listUserPages(userToken);
  } catch (err) {
    console.error("[meta oauth] list pages failed", err);
    return NextResponse.redirect(land("list_pages_failed"));
  }

  if (!pages.length) return NextResponse.redirect(land("no_pages"));

  let connected = 0;
  for (const p of pages) {
    // Subscribe app to receive webhooks for this page
    const ok = await subscribePageToApp(p.id, p.access_token);
    if (!ok) console.warn("[meta oauth] subscribePageToApp failed for", p.id);

    const igId = p.instagram_business_account?.id ?? null;
    const igUsername = igId ? await getInstagramUsername(igId, p.access_token) : null;

    const { error: upsertErr } = await supabaseAdmin
      .from("meta_page_subscriptions")
      .upsert(
        {
          client_id: clientId,
          page_id: p.id,
          page_name: p.name,
          page_access_token: p.access_token,
          instagram_account_id: igId,
          instagram_username: igUsername,
          active: true,
        },
        { onConflict: "page_id" }
      );
    if (upsertErr) console.error("[meta oauth] upsert failed", upsertErr);
    else connected++;
  }

  await logEvent({
    clientId,
    category: "steward",
    level: "info",
    message: `Meta connected: ${connected} page(s)`,
    metadata: { mode, pages: pages.map((p) => ({ id: p.id, name: p.name, ig: p.instagram_business_account?.id })) },
  });

  const target = mode === "admin" ? `${ADMIN_URL}/clients/${clientId}?meta_install=connected` : land("connected");
  const res = NextResponse.redirect(target);
  res.cookies.set("meta_install_state", "", {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/", domain: ".gb2gllc.com",
  });
  return res;
}
