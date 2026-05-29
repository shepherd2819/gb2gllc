import { supabaseAdmin } from "@/lib/supabase";
import { loadMasterTemplate, type SubstitutionVars } from "@/lib/vera/template";
import { ContractHtml } from "@/lib/vera/html";
import { formatAmount, cadenceLabel, type Cadence } from "@/lib/vera/format";
import { DEFAULT_SCOPE, PRODUCT_LABELS, type Product } from "@/lib/vera/product-scopes";
import { SignForm } from "./SignForm";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: c } = await supabaseAdmin
    .from("contracts")
    .select("id, status, product, amount_cents, cadence, scope_notes, expires_at, signer_name, signed_at, clients(name, company, email)")
    .eq("token", token)
    .maybeSingle();

  if (!c) {
    return <Shell><Message title="Not found" body="We couldn't find a contract at this link. Double-check the URL or contact john@gb2gllc.com." /></Shell>;
  }
  if (c.status === "voided") {
    return <Shell><Message title="This contract has been voided" body="Contact john@gb2gllc.com for a fresh copy." /></Shell>;
  }
  if (c.status === "expired" || new Date(c.expires_at as string) < new Date()) {
    return <Shell><Message title="This contract link has expired" body="Contact john@gb2gllc.com for a fresh copy." /></Shell>;
  }
  if (c.status === "signed") {
    return <Shell><Message title="Already signed" body={`Signed${c.signer_name ? ` by ${c.signer_name}` : ""}${c.signed_at ? ` on ${new Date(c.signed_at as string).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}.`} /></Shell>;
  }
  if (c.status !== "sent") {
    return <Shell><Message title="This link is not yet active" body="Contact john@gb2gllc.com if you believe this is a mistake." /></Shell>;
  }

  const client = c.clients as unknown as { name: string | null; company: string | null; email: string };
  const product = c.product as Product;
  const cadence = c.cadence as Cadence;
  const tmpl = await loadMasterTemplate();
  const vars: SubstitutionVars = {
    client_company:    client.company || client.name || client.email,
    product_label:     PRODUCT_LABELS[product],
    scope_paragraph:   (c.scope_notes as string | null)?.trim() || DEFAULT_SCOPE[product],
    amount_formatted:  formatAmount(c.amount_cents as number),
    cadence_label:     cadenceLabel(cadence),
    generated_date:    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    signer_name:       "",
    signer_representing: "",
    signed_date:       "",
  };

  return (
    <Shell>
      <ContractHtml sections={tmpl.sections} vars={vars} />
      <SignForm token={token} defaultRepresenting={client.company || client.name || ""} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GB2GLLC · Services Agreement</title>
        <style>{`
          :root { --ink:#1c1c1c; --paper:#f8f5ef; --rule:#d8d2c5; --accent:#4a5c45; }
          html,body { background:var(--paper); color:var(--ink); margin:0; padding:0; font-family: Geist, -apple-system, BlinkMacSystemFont, "SF Pro", sans-serif; }
          main { max-width: 720px; margin: 0 auto; padding: 48px 24px 96px; }
          h1 { font-size: 28px; margin: 0 0 4px; }
          h2 { font-size: 14px; margin: 24px 0 6px; letter-spacing: 0.02em; }
          h3 { font-size: 14px; margin: 24px 0 6px; }
          p { line-height: 1.55; margin: 0 0 10px; }
          .sign-effective { color:#6b6757; font-size:13px; margin-bottom:24px; }
          .sign-block { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--rule); }
          .sign-form { margin-top: 40px; padding-top: 24px; border-top: 2px solid var(--ink); }
          .sign-form label { display:block; font-size:13px; margin-top:14px; }
          .sign-form input[type=text] { width:100%; padding:10px 12px; border:1px solid var(--rule); border-radius:6px; font:inherit; background:#fff; }
          .sign-form .check { display:flex; gap:10px; align-items:flex-start; margin-top:16px; font-size:13px; }
          .sign-form button { margin-top:20px; background:var(--accent); color:#fff; border:0; border-radius:8px; padding:12px 22px; font:inherit; cursor:pointer; }
          .sign-form button:disabled { opacity:0.4; cursor:not-allowed; }
          .sign-message { padding:48px 24px; text-align:center; }
          .sign-error { color:#a33; margin-top:10px; }
          .sign-success { padding:48px 24px; text-align:center; }
          .sign-success h2 { font-size:22px; }
        `}</style>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="sign-message">
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}
