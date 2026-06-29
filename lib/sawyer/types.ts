export const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "declined"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type PricingSource = "rate_card" | "custom_override" | "needs_confirmation";
export type PricingCadence = "monthly" | "one_time" | "annual";

export type PricingLineItem = {
  label: string;
  amount: number | null; // null when needs_confirmation
  cadence: PricingCadence;
  note?: string;
};

export type ProposalPricing = {
  source: PricingSource;
  items: PricingLineItem[];
  summary?: string;
};

export type ProposalSection = {
  key: string;     // e.g. "cover", "about", "scope", "pricing", "timeline", "terms"
  heading: string;
  body: string;    // markdown
};

export type Proposal = {
  id: string;
  client_id: string | null;
  prospect_name: string | null;
  title: string;
  status: ProposalStatus;
  sections: ProposalSection[];
  pricing: ProposalPricing | null;
  markdown: string | null;
  public_token: string;
  viewed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type RateCardItem = {
  key: string;          // "hollis" | "herald" | "atrium" | "steward"
  product: string;      // display name
  summary: string;      // one line of what it is
  display: string;      // human price string, e.g. "$1,500–$5,000/mo"
  amount: number | null;
  cadence: PricingCadence | null;
  status: "available" | "launching" | "custom";
};

export type ClientContext = {
  kind: "client";
  id: string;
  name: string;
  company: string;
  email: string;
  status: string;
  products: string[];
  memberCount: number;
  hasHollis: boolean;
  hollisSummary?: string;
  recentTicketCount: number;
};

export type ProspectContext = {
  kind: "prospect";
  name: string;
  company?: string;
  notes?: string;
};

export type SawyerContext = ClientContext | ProspectContext;
