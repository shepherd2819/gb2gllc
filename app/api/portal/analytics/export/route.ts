// app/api/portal/analytics/export/route.ts
import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getPortalClientId } from "@/lib/portal-auth";
import { buildExportRows, toCsv } from "@/lib/analytics/csv";
import { renderAnalyticsReportPdf } from "@/lib/analytics/report-pdf";
import { readSnapshot, recordEvent } from "@/lib/analytics/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Tenant isolation: clientId derives from the session, NEVER a query param.
  const clientId = await getPortalClientId(user.id);
  if (!clientId) return Response.json({ error: "No client" }, { status: 403 });

  const format = req.nextUrl.searchParams.get("format");
  const today = new Date().toISOString().slice(0, 10);

  try {
    const snapshot = await readSnapshot(clientId);
    if (!snapshot) return Response.json({ error: "No analytics data yet" }, { status: 404 });

    if (format === "csv") {
      const table = req.nextUrl.searchParams.get("table") ?? "";
      const built = buildExportRows(snapshot.payload, table);
      if (!built) {
        return Response.json(
          { error: "Unknown table; use trend | productMix | statusMix | topCompanies | topAgents" },
          { status: 400 },
        );
      }
      await recordEvent(clientId, "export.csv", user.id, { table });
      return new Response(toCsv(built.headers, built.rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="analytics-${table}-${today}.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const pdf = await renderAnalyticsReportPdf(snapshot);
      await recordEvent(clientId, "export.pdf", user.id, {});
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="analytics-report-${today}.pdf"`,
        },
      });
    }

    return Response.json({ error: "Unknown format; use format=csv&table=… or format=pdf" }, { status: 400 });
  } catch (err) {
    console.error("[analytics/export]", err);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}
