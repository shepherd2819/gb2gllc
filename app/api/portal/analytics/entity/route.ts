// app/api/portal/analytics/entity/route.ts
import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getPortalClientId } from "@/lib/portal-auth";
import { queryMetrics } from "@/lib/analytics/store";
import { buildEntitySeries, trailingMonthKeys } from "@/lib/analytics/entity";

export const dynamic = "force-dynamic";

const DIMS = new Set(["company", "product", "status", "agent"]);

export async function GET(req: NextRequest) {
  const { user } = await withAuth();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Tenant isolation: clientId derives from the session, NEVER the query.
  const clientId = await getPortalClientId(user.id);
  if (!clientId) return Response.json({ error: "No client" }, { status: 401 });

  const dim = req.nextUrl.searchParams.get("dim") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!DIMS.has(dim)) {
    return Response.json({ error: "dim must be one of company|product|status|agent" }, { status: 400 });
  }
  if (name.length < 1 || name.length > 120) {
    return Response.json({ error: "name must be 1-120 characters" }, { status: 400 });
  }

  const months = trailingMonthKeys(new Date(), 13);
  const from = `${months[0]}-01`;
  const to = `${months[months.length - 1]}-01`;
  const dimension = { [dim]: name };

  try {
    // queryMetrics is client-scoped (.eq('client_id', clientId)) and capped 500.
    const [rev, cnt] = await Promise.all([
      queryMetrics(clientId, { metric: "orders.revenue", grain: "month", from, to, dimension }),
      queryMetrics(clientId, { metric: "orders.count", grain: "month", from, to, dimension }),
    ]);
    const { months: series, totals } = buildEntitySeries([...rev, ...cnt], months);
    return Response.json({ dim, name, months: series, totals });
  } catch (err) {
    // Fail-soft: the deep-dive panel renders its empty state on an empty series.
    console.error("[analytics/entity]", err);
    return Response.json({ dim, name, months: [], totals: { revenue: 0, orders: 0 } });
  }
}
