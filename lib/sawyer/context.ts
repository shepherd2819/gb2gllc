// The "live" knowledge layer: shapes Supabase rows into a compact, typed
// context for Sawyer. Pure shapers are unit-tested; fetchers are thin
// lazy-import wrappers (repo convention).
import type { ClientContext, ProspectContext } from "./types";

type ShapeInput = {
  client: { id: string; name: string; company: string; email: string; status: string };
  products: Array<{ product: string; active: boolean }>;
  memberCount: number;
  hollisLine: { agent_name?: string; voice_profile?: string } | null;
  recentTicketCount: number;
};

export function shapeClientContext(input: ShapeInput): ClientContext {
  const products = input.products.filter((p) => p.active).map((p) => p.product);
  const hasHollis = !!input.hollisLine;
  const hollisSummary = input.hollisLine
    ? `Hollis live as "${input.hollisLine.agent_name ?? "the receptionist"}" (${input.hollisLine.voice_profile ?? "voice set"}).`
    : undefined;
  return {
    kind: "client",
    id: input.client.id,
    name: input.client.name ?? "",
    company: input.client.company ?? "",
    email: input.client.email ?? "",
    status: input.client.status ?? "unknown",
    products,
    memberCount: input.memberCount,
    hasHollis,
    hollisSummary,
    recentTicketCount: input.recentTicketCount,
  };
}

export function buildProspectContext(input: { name: string; company?: string; notes?: string }): ProspectContext {
  return {
    kind: "prospect",
    name: input.name.trim(),
    company: input.company?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  };
}

// Escape PostgREST/ilike special chars so user input cannot alter the filter.
// Backslash first, then quote and the ilike wildcards. The value is wrapped in
// double quotes at the call site, which neutralizes structural delimiters (, . : ( )).
export function escapeSearchTerm(term: string): string {
  return term.replace(/[\\"%_]/g, (m) => "\\" + m);
}

export async function getClientContext(clientId: string): Promise<ClientContext | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, name, company, email, status")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  const [{ data: products }, { count: memberCount }, { data: hollisLine }, { count: ticketCount }] =
    await Promise.all([
      supabaseAdmin.from("client_products").select("product, active").eq("client_id", clientId),
      supabaseAdmin.from("client_members").select("id", { count: "exact", head: true }).eq("client_id", clientId),
      supabaseAdmin
        .from("hollis_lines")
        .select("agent_name, voice_profile")
        .eq("client_id", clientId)
        .maybeSingle(),
      supabaseAdmin.from("tickets").select("id", { count: "exact", head: true }).eq("client_id", clientId),
    ]);

  return shapeClientContext({
    client: client as ShapeInput["client"],
    products: (products ?? []) as ShapeInput["products"],
    memberCount: memberCount ?? 0,
    hollisLine: (hollisLine as ShapeInput["hollisLine"]) ?? null,
    recentTicketCount: ticketCount ?? 0,
  });
}

export async function searchClients(q: string): Promise<Array<{ id: string; name: string; company: string }>> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const term = q.trim();
  let query = supabaseAdmin.from("clients").select("id, name, company").order("name").limit(20);
  if (term) {
    const safe = escapeSearchTerm(term);
    query = query.or(`name.ilike."%${safe}%",company.ilike."%${safe}%"`);
  }
  const { data } = await query;
  return (data ?? []) as Array<{ id: string; name: string; company: string }>;
}
