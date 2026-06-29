// app/(admin)/agents/sawyer/SawyerConsole.tsx
"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };
type ProposalRow = { id: string; title: string; status: string; client_id: string | null; prospect_name: string | null; public_token: string; updated_at: string };
type ClientRow = { id: string; name: string; company: string };

export default function SawyerConsole() {
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = () => fetch("/api/admin/sawyer/proposals").then((r) => r.json()).then((d) => setProposals(d.proposals ?? []));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/admin/sawyer/clients?q=${encodeURIComponent(clientQuery)}`).then((r) => r.json()).then((d) => setClients(d.clients ?? []));
    }, 200);
    return () => clearTimeout(t);
  }, [clientQuery]);

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setMessages((m) => [...m, { role: "user", content: userMsg }, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    try {
      const res = await fetch("/api/admin/sawyer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: activeId, clientId, message: userMsg }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]" || payload === '"[DONE]"') continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.token) setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: c[c.length - 1].content + obj.token }; return c; });
            if (obj.proposal) { setActiveId(obj.proposal.id); setActiveToken(obj.proposal.public_token); refresh(); }
          } catch { /* ignore keepalive */ }
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  function openProposal(p: ProposalRow) {
    setActiveId(p.id); setActiveToken(p.public_token); setClientId(p.client_id);
    setMessages([]);
  }
  function newProposal() { setActiveId(null); setActiveToken(null); setMessages([]); setClientId(null); }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, height: "calc(100vh - 120px)" }}>
      <aside style={{ borderRight: "1px solid #e6e6e6", paddingRight: 12, overflowY: "auto" }}>
        <button onClick={newProposal} style={{ width: "100%", padding: 8, marginBottom: 12 }}>+ New proposal</button>
        <input placeholder="Search clients…" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} style={{ width: "100%", padding: 6, marginBottom: 8 }} />
        {clients.map((c) => (
          <div key={c.id} onClick={() => setClientId(c.id)} style={{ padding: 6, cursor: "pointer", background: clientId === c.id ? "#f0f0f0" : "transparent", borderRadius: 6 }}>
            {c.company || c.name}
          </div>
        ))}
        <h4 style={{ marginTop: 16 }}>Proposals</h4>
        {proposals.map((p) => (
          <div key={p.id} onClick={() => openProposal(p)} style={{ padding: 6, cursor: "pointer", fontWeight: activeId === p.id ? 700 : 400 }}>
            {p.title} <span style={{ color: "#888", fontSize: 12 }}>· {p.status}</span>
          </div>
        ))}
      </aside>
      <main style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ margin: "8px 0", textAlign: m.role === "user" ? "right" : "left" }}>
              <span style={{ display: "inline-block", padding: "8px 12px", borderRadius: 10, background: m.role === "user" ? "#1a1a1a" : "#f3f3f3", color: m.role === "user" ? "#fff" : "#1a1a1a", whiteSpace: "pre-wrap", maxWidth: "80%" }}>{m.content || "…"}</span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {activeToken && (
          <div style={{ display: "flex", gap: 8, padding: "8px 0", fontSize: 14 }}>
            <button onClick={() => navigator.clipboard.writeText(`${location.origin}/proposals/${activeToken}`)}>Copy link</button>
            <a href={`/api/admin/sawyer/proposals/${activeId}/pdf`} target="_blank" rel="noreferrer">Download PDF</a>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={clientId ? "Describe the deal…" : "Pick a client first (or just describe a prospect)…"} style={{ flex: 1, padding: 10 }} disabled={streaming} />
          <button onClick={send} disabled={streaming}>{streaming ? "…" : "Send"}</button>
        </div>
      </main>
    </div>
  );
}
