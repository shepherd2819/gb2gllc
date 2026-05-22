import { supabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ level?: string; category?: string }> };

export default async function ClientLogsPage({ params, searchParams }: Params) {
  const { id } = await params;
  const { level, category } = await searchParams;

  const { data: client } = await supabaseAdmin
    .from("clients").select("name, company, email").eq("id", id).single();
  if (!client) notFound();

  let query = supabaseAdmin
    .from("client_logs")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (level) query = query.eq("level", level);
  if (category) query = query.eq("category", category);

  const { data: logs } = await query;

  return (
    <>
      <div className="admin-page-header">
        <div>
          <a href={`/clients/${id}`} className="back-link">← {client.company || client.name || client.email}</a>
          <h1>Full Logs</h1>
        </div>
        <div className="log-filters">
          {["info","warn","error"].map(l => (
            <a key={l} href={`?level=${l}${category ? `&category=${category}` : ""}`} className={`filter-chip ${level === l ? "active" : ""}`}>{l}</a>
          ))}
          {["herald","intake","steward","system"].map(c => (
            <a key={c} href={`?category=${c}${level ? `&level=${level}` : ""}`} className={`filter-chip ${category === c ? "active" : ""}`}>{c}</a>
          ))}
          {(level || category) && <a href="?" className="filter-chip clear">clear</a>}
        </div>
      </div>

      <div className="log-full-list">
        {(logs ?? []).length === 0 && <div className="admin-empty">No logs match these filters.</div>}
        {(logs ?? []).map(l => (
          <div key={l.id} className={`log-full-row level-${l.level}`}>
            <span className="lf-time">{new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
            <span className={`log-level ${l.level}`}>{l.level}</span>
            <span className="log-cat">{l.category}</span>
            <span className="lf-msg">{l.message}</span>
            {l.metadata && <pre className="lf-meta">{JSON.stringify(l.metadata, null, 2)}</pre>}
            {l.session_id && <span className="lf-session">session: {l.session_id}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
