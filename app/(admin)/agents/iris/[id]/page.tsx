import { supabaseAdmin } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { IrisInbox } from "./IrisInbox";

export const dynamic = "force-dynamic";

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
};

type Settings = {
  account_id: string;
  draft_categories: string[];
  ignore_from_patterns: string[];
  voice_notes: string | null;
  signature: string | null;
};

export default async function IrisAccountPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string; status?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const { data: account } = await supabaseAdmin
    .from("iris_inbox_accounts")
    .select("id, email_address, aliases, status")
    .eq("id", id)
    .single<Account>();
  if (!account) notFound();

  // Default filter: show classified messages (drafts ready for review), most recent 100.
  const statusFilter = sp.status ?? "classified";
  const categoryFilter = sp.category ?? "";

  let q = supabaseAdmin
    .from("iris_messages")
    .select("id, from_email, from_name, delivered_to, subject, snippet, received_at, category, priority, reasoning, suggested_action, draft_reply, body_text, body_purged_at, status, classify_error, gmail_draft_id, gmail_thread_id")
    .eq("account_id", account.id)
    .order("received_at", { ascending: false })
    .limit(100);
  if (statusFilter !== "all") q = q.eq("status", statusFilter);
  if (categoryFilter)        q = q.eq("category", categoryFilter);

  const { data: messages } = await q;

  const { data: settings } = await supabaseAdmin
    .from("iris_settings")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle<Settings>();

  return (
    <IrisInbox
      account={account}
      initialMessages={(messages ?? []) as Message[]}
      settings={settings ?? {
        account_id: account.id,
        draft_categories: ["lead", "support", "internal"],
        ignore_from_patterns: ["noreply@", "no-reply@", "donotreply@", "mailer-daemon@"],
        voice_notes: null,
        signature: null,
      }}
      currentStatus={statusFilter}
      currentCategory={categoryFilter}
    />
  );
}
