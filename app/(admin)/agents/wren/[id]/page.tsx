import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { WrenInbox } from "./WrenInbox";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "john@gb2gllc.com";

type Account = {
  id: string;
  email_address: string;
  aliases: string[];
  status: string;
};

type Message = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  delivered_to: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  category: string | null;
  priority: string | null;
  reasoning: string | null;
  suggested_action: string | null;
  draft_reply: string | null;
  body_text: string | null;
  body_purged_at: string | null;
  status: string;
  classify_error: string | null;
  gmail_draft_id: string | null;
  gmail_thread_id: string;
  matched_client_id: string | null;
};

type Settings = {
  account_id: string;
  draft_categories: string[];
  ignore_from_patterns: string[];
  voice_notes: string | null;
  signature: string | null;
};

export default async function WrenInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; category?: string }>;
}) {
  const { user } = await withAuth();
  if (!user) redirect("/auth/signin");
  if (user.email !== ADMIN_EMAIL) redirect("/auth/no-account");

  const { id } = await params;
  const sp = await searchParams;

  const { data: account } = await supabaseAdmin
    .from("wren_inbox_accounts")
    .select("id, email_address, aliases, status")
    .eq("id", id)
    .single<Account>();
  if (!account) redirect("/agents/wren");

  const statusFilter   = sp.status   ?? "classified";
  const categoryFilter = sp.category ?? "";

  let q = supabaseAdmin
    .from("wren_messages")
    .select("id, from_email, from_name, delivered_to, subject, snippet, received_at, category, priority, reasoning, suggested_action, draft_reply, body_text, body_purged_at, status, classify_error, gmail_draft_id, gmail_thread_id, matched_client_id")
    .eq("account_id", account.id)
    .order("received_at", { ascending: false })
    .limit(100);
  if (statusFilter !== "all") q = q.eq("status", statusFilter);
  if (categoryFilter)         q = q.eq("category", categoryFilter);

  const { data: messages } = await q;

  const { data: settings } = await supabaseAdmin
    .from("wren_settings")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle<Settings>();

  const defaultSettings: Settings = {
    account_id: account.id,
    draft_categories: ["bug", "feature_request", "account_help", "billing_question", "general"],
    ignore_from_patterns: ["noreply@", "no-reply@", "donotreply@", "mailer-daemon@"],
    voice_notes: null,
    signature: null,
  };

  return (
    <WrenInbox
      account={account}
      initialMessages={(messages ?? []) as Message[]}
      settings={settings ?? defaultSettings}
      currentStatus={statusFilter}
      currentCategory={categoryFilter}
    />
  );
}
