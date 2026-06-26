// Per-product / per-tier milestone playbooks. A journey is seeded from the
// template matching the client's product; higher tiers add steps (e.g. a
// security/SSO setup milestone for white-glove/enterprise).

import type { MilestoneSeed, OnboardingTier } from "./types";

const STANDARD: MilestoneSeed[] = [
  { key: "sign_contract", title: "Sign your agreement", owner: "client", sort_order: 0 },
  { key: "pay_invoice", title: "Complete your first payment", owner: "client", sort_order: 1 },
  { key: "book_kickoff", title: "Book your kickoff call", owner: "client", sort_order: 2 },
  { key: "share_access", title: "Share the details & access we need", owner: "client", sort_order: 3 },
  { key: "configure_agents", title: "We configure your AI agents", owner: "gb2g", sort_order: 4 },
  { key: "first_agent_live", title: "Your first agent goes live", owner: "gb2g", sort_order: 5 },
  { key: "go_live", title: "You're fully live", owner: "gb2g", sort_order: 6 },
];

const HERALD: MilestoneSeed[] = [
  { key: "sign_contract", title: "Sign your agreement", owner: "client", sort_order: 0 },
  { key: "pay_invoice", title: "Complete your first payment", owner: "client", sort_order: 1 },
  { key: "book_kickoff", title: "Book your kickoff call", owner: "client", sort_order: 2 },
  { key: "install_snippet", title: "Add the Herald chat snippet to your site", owner: "client", sort_order: 3 },
  { key: "configure_agents", title: "We tune your Herald assistant", owner: "gb2g", sort_order: 4 },
  { key: "first_agent_live", title: "Herald goes live on your site", owner: "gb2g", sort_order: 5 },
  { key: "go_live", title: "You're fully live", owner: "gb2g", sort_order: 6 },
];

const STEWARD: MilestoneSeed[] = [
  { key: "sign_contract", title: "Sign your agreement", owner: "client", sort_order: 0 },
  { key: "pay_invoice", title: "Complete your first payment", owner: "client", sort_order: 1 },
  { key: "book_kickoff", title: "Book your kickoff call", owner: "client", sort_order: 2 },
  { key: "connect_platforms", title: "Connect your platforms (email, Slack, calendar…)", owner: "client", sort_order: 3 },
  { key: "configure_agents", title: "We set up your AI employees", owner: "gb2g", sort_order: 4 },
  { key: "first_agent_live", title: "Your first AI employee starts working", owner: "gb2g", sort_order: 5 },
  { key: "go_live", title: "You're fully live", owner: "gb2g", sort_order: 6 },
];

export const TEMPLATES: Record<string, MilestoneSeed[]> = {
  standard: STANDARD,
  herald: HERALD,
  atrium: STANDARD, // website build uses the standard arc; Atrium tracks its own build stages elsewhere
  steward: STEWARD,
  custom: STANDARD,
};

export function templateFor(product: string, tier: OnboardingTier): { key: string; tier: OnboardingTier; milestones: MilestoneSeed[] } {
  const key = TEMPLATES[product] ? product : "standard";
  let milestones = [...TEMPLATES[key]];
  if (tier === "white_glove") {
    milestones = [...milestones, { key: "security_review", title: "Security review & SSO setup", owner: "gb2g", sort_order: 99 }];
  }
  // Re-normalize sort_order so it's contiguous regardless of source ordering.
  milestones = milestones
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((m, i) => ({ ...m, sort_order: i }));
  return { key, tier, milestones };
}
