import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "@/lib/supabase";
import { HERALD_PRODUCT } from "@/lib/intake/herald";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  // Validate session exists and is not expired
  const { data, error } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, expires_at, intended_product")
    .eq("id", sessionId)
    .single();

  if (error || !data || new Date(data.expires_at) < new Date()) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px">
        <p>This intake link is invalid or has expired.</p>
        <a href="/">← Back to home</a>
      </body></html>`,
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }

  const isHerald = data.intended_product === HERALD_PRODUCT;
  let html = readFileSync(
    join(process.cwd(), "public", isHerald ? "intake-herald.html" : "intake.html"),
    "utf-8"
  );

  // Inject session ID and Calendly URL before </head>
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL ?? "";
  html = html.replace(
    "</head>",
    `<script>window.GB2G_SESSION_ID = ${JSON.stringify(sessionId)};window.GB2G_CALENDLY_URL = ${JSON.stringify(calendlyUrl)};${isHerald ? `window.GB2G_INTAKE_MODE = ${JSON.stringify(HERALD_PRODUCT)};` : ""}</script>\n</head>`
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
