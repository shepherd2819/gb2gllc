import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect, notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { signedContractPdfUrl } from "@/lib/vera/storage";
import { ActionBar } from "./ActionBar";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function VeraDetailPage({ params }: { params: Promise<{ contractId: string }> }) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { contractId } = await params;
  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("*, clients(name, company, email)")
    .eq("id", contractId)
    .maybeSingle();
  if (!c) notFound();

  const client = c.clients as unknown as { name: string | null; company: string | null; email: string };
  const marketingUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://gb2gllc.com";
  const signingUrl = `${marketingUrl}/sign/${c.token}`;

  const unsignedUrl = c.unsigned_pdf_path ? await signedContractPdfUrl(c.unsigned_pdf_path as string).catch(() => null) : null;
  const signedUrl   = c.signed_pdf_path   ? await signedContractPdfUrl(c.signed_pdf_path as string).catch(() => null)   : null;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{client.company || client.name} · {c.product}</h1>
        <p className="page-sub">
          <span className={`badge ${c.status}`}>{c.status}</span>
          {" · "}${((c.amount_cents as number) / 100).toFixed(2)} / {c.cadence}
        </p>
      </div>

      <table style={{ borderCollapse: "collapse", fontSize: 14, marginBottom: 20 }}>
        <tbody>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Client</td>
            <td style={{ paddingBottom: 8 }}>{client.company || client.name || client.email}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Email</td>
            <td style={{ paddingBottom: 8 }}>{client.email}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Scope notes</td>
            <td style={{ paddingBottom: 8 }}>{(c.scope_notes as string) || <em>default</em>}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Sent</td>
            <td style={{ paddingBottom: 8 }}>{c.sent_at ? new Date(c.sent_at as string).toLocaleString() : "—"}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Viewed</td>
            <td style={{ paddingBottom: 8 }}>{c.viewed_at ? new Date(c.viewed_at as string).toLocaleString() : "—"}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Reminder sent</td>
            <td style={{ paddingBottom: 8 }}>{c.reminder_sent_at ? new Date(c.reminder_sent_at as string).toLocaleString() : "—"}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Signed</td>
            <td style={{ paddingBottom: 8 }}>{c.signed_at ? new Date(c.signed_at as string).toLocaleString() : "—"}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Signer</td>
            <td style={{ paddingBottom: 8 }}>
              {(c.signer_name as string) ?? "—"}
              {(c.signer_representing as string) ? ` · ${c.signer_representing}` : ""}
            </td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Signer IP / UA</td>
            <td style={{ paddingBottom: 8, wordBreak: "break-all" }}>
              {((c.signer_ip as string) ?? "—") + " · " + ((c.signer_user_agent as string) ?? "—")}
            </td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Expires</td>
            <td style={{ paddingBottom: 8 }}>{new Date(c.expires_at as string).toLocaleString()}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Template version</td>
            <td style={{ paddingBottom: 8 }}>{(c.template_version as string) ?? "—"}</td>
          </tr>
          <tr>
            <td style={{ paddingRight: 24, paddingBottom: 8, color: "var(--text-mute)", whiteSpace: "nowrap", verticalAlign: "top" }}>Notion page</td>
            <td style={{ paddingBottom: 8 }}>
              {c.notion_page_id
                ? <a href={`https://www.notion.so/${(c.notion_page_id as string).replace(/-/g, "")}`} target="_blank" rel="noreferrer">Open in Notion</a>
                : <em>not synced</em>
              }
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 16 }}>
        {unsignedUrl && (
          <a className="admin-btn" href={unsignedUrl} target="_blank" rel="noreferrer">
            Download unsigned PDF
          </a>
        )}{" "}
        {signedUrl && (
          <a className="admin-btn" href={signedUrl} target="_blank" rel="noreferrer">
            Download signed PDF
          </a>
        )}{" "}
        {c.status === "sent" && (
          <a className="admin-btn" href={signingUrl} target="_blank" rel="noreferrer">
            View signing page
          </a>
        )}
      </div>

      <ActionBar id={contractId} status={c.status as string} hasNotion={Boolean(c.notion_page_id)} />
    </>
  );
}
