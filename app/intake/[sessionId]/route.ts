import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  // Validate session exists and is not expired
  const { data, error } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, expires_at")
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

  let html = readFileSync(join(process.cwd(), "public", "intake.html"), "utf-8");

  // Inject session ID before </head>
  html = html.replace(
    "</head>",
    `<script>window.GB2G_SESSION_ID = ${JSON.stringify(sessionId)};</script>\n</head>`
  );

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
