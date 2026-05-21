import { readFileSync } from "fs";
import { join } from "path";

// Serves public/workbench.html at the root URL
export async function GET() {
  const html = readFileSync(join(process.cwd(), "public", "workbench.html"), "utf-8");
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
