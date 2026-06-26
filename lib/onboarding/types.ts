export type OnboardingTier = "self_serve" | "assisted" | "white_glove";

export type OnboardingStage =
  | "invited"
  | "kickoff_scheduled"
  | "provisioning"
  | "activated"
  | "adopted"
  | "complete"
  | "stalled";

export type MilestoneOwner = "client" | "gb2g";
export type MilestoneStatus = "pending" | "in_progress" | "done" | "blocked" | "skipped";

export type Product = "herald" | "atrium" | "steward" | "custom";
export type MemberRole = "owner" | "admin" | "member" | "billing" | "read_only";

export type MilestoneSeed = {
  key: string;
  title: string;
  owner: MilestoneOwner;
  sort_order: number;
};

export type MilestoneRow = {
  id: string;
  journey_id: string;
  key: string;
  title: string;
  owner: MilestoneOwner;
  status: MilestoneStatus;
  sort_order: number;
  due_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
};

export type JourneyRow = {
  id: string;
  client_id: string;
  template: string;
  tier: OnboardingTier;
  stage: OnboardingStage;
  owner_csm: string | null;
  ttv_target_at: string | null;
  activated_at: string | null;
  completed_at: string | null;
};
