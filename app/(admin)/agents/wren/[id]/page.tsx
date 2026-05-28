import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { WrenInbox } from "./WrenInbox";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

export default async function WrenInboxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { id } = await params;
  const { data: account } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("id, email_address, status, last_polled_at, last_poll_error")
    .eq("id", id)
    .single();
  if (!account) redirect("/agents/wren");

  const { data: messages } = await supabaseAdmin
    .from("wren_messages")
    .select("id, from_email, from_name, subject, snippet, category, priority, suggested_action, draft_reply, status, received_at, classify_error, matched_client_id")
    .eq("account_id", id)
    .order("received_at", { ascending: false })
    .limit(100);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{account.email_address}</h1>
        <p className="page-sub">{messages?.length ?? 0} recent messages · status {account.status}</p>
      </div>
      <WrenInbox accountId={account.id} messages={messages ?? []} />
    </>
  );
}
