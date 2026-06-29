import { randomBytes } from "node:crypto";
import type { ChatMessage, Proposal, ProposalPricing, ProposalSection, ProposalStatus } from "./types";

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

const CADENCE_SUFFIX: Record<string, string> = { monthly: "/mo", annual: "/yr", one_time: "" };

function formatAmount(amount: number | null, cadence: string): string {
  if (amount == null) return "To confirm";
  return `$${amount.toLocaleString("en-US")}${CADENCE_SUFFIX[cadence] ?? ""}`;
}

export function flattenToMarkdown(
  title: string,
  sections: ProposalSection[],
  pricing: ProposalPricing | null
): string {
  const parts: string[] = [`# ${title}`];
  for (const s of sections) {
    parts.push(`## ${s.heading}\n\n${s.body}`);
  }
  if (pricing) {
    const lines = pricing.items.map((i) => `- **${i.label}** — ${formatAmount(i.amount, i.cadence)}${i.note ? ` (${i.note})` : ""}`);
    parts.push(`## Pricing\n\n${lines.join("\n")}${pricing.summary ? `\n\n${pricing.summary}` : ""}`);
  }
  return parts.join("\n\n");
}

type CreateInput = {
  client_id: string | null;
  prospect_name: string | null;
  title: string;
  sections: ProposalSection[];
  pricing: ProposalPricing | null;
  created_by: string;
};

function rowToProposal(row: Record<string, unknown>): Proposal {
  return row as unknown as Proposal;
}

export async function createProposal(input: CreateInput): Promise<Proposal> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const markdown = flattenToMarkdown(input.title, input.sections, input.pricing);
  const { data, error } = await supabaseAdmin
    .from("proposals")
    .insert({
      client_id: input.client_id,
      prospect_name: input.prospect_name,
      title: input.title,
      sections: input.sections,
      pricing: input.pricing,
      markdown,
      public_token: generateToken(),
      created_by: input.created_by,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToProposal(data);
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data, error } = await supabaseAdmin.from("proposals").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToProposal(data) : null;
}

export async function getProposalByToken(token: string): Promise<Proposal | null> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data, error } = await supabaseAdmin.from("proposals").select("*").eq("public_token", token).maybeSingle();
  if (error) throw error;
  return data ? rowToProposal(data) : null;
}

export async function listProposals(): Promise<Proposal[]> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data, error } = await supabaseAdmin.from("proposals").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToProposal);
}

type UpdatePatch = {
  title?: string;
  status?: ProposalStatus;
  sections?: ProposalSection[];
  pricing?: ProposalPricing | null;
};

export async function updateProposal(id: string, patch: UpdatePatch): Promise<Proposal> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const existing = await getProposal(id);
  if (!existing) throw new Error("proposal not found");
  const title = patch.title ?? existing.title;
  const sections = patch.sections ?? existing.sections;
  const pricing = patch.pricing !== undefined ? patch.pricing : existing.pricing;
  const markdown = flattenToMarkdown(title, sections, pricing);
  const { data, error } = await supabaseAdmin
    .from("proposals")
    .update({ ...patch, markdown, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return rowToProposal(data);
}

export async function markViewed(token: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { error } = await supabaseAdmin
    .from("proposals")
    .update({ viewed_at: new Date().toISOString() })
    .eq("public_token", token)
    .is("viewed_at", null);
  if (error) throw error;
}

export async function appendMessage(proposalId: string, role: "user" | "assistant", content: string): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { error } = await supabaseAdmin.from("proposal_messages").insert({ proposal_id: proposalId, role, content });
  if (error) throw error;
}

export async function getMessages(proposalId: string): Promise<ChatMessage[]> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data, error } = await supabaseAdmin
    .from("proposal_messages")
    .select("role, content")
    .eq("proposal_id", proposalId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}
