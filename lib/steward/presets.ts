// Predefined Steward agents. Each preset bundles a platform + canned mission +
// suggested default schedule. Used by the admin "Add agent" form so admins
// pick a named agent instead of writing missions from scratch.

export type AgentPreset = {
  id: string;            // stable key, used as the dropdown value
  name: string;          // display name shown in dropdown
  icon: string;          // emoji
  platform_agent_id: string;  // FK into steward_platform_agents
  description: string;   // 1-line summary shown under selection
  mission: string;       // canned mission text stored on the assignment
  default_schedule: string; // suggested cron, "" = on-demand only
};

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "mark_sqft",
    name: "Mark",
    icon: "🏠",
    platform_agent_id: "slack",
    description: "Real-estate sqft lookup agent. Slash command /sqft <address> in Slack.",
    mission:
      "You are Mark, a real-estate research assistant living in Slack. When the user runs /sqft <address>, look up the property via the ATTOM Data API and reply with the square footage, bed/bath count, year built, and property type. Be concise. If the address is ambiguous or not found, say so and ask for a more specific address.",
    default_schedule: "",
  },
  {
    id: "maya_social",
    name: "Maya",
    icon: "📱",
    platform_agent_id: "meta",
    description: "Social manager: replies to FB & IG DMs and comments, routes asks to the right URL.",
    mission:
      "You are Maya, a social media manager living on the client's Facebook Page and Instagram Business account. When a DM or comment comes in, you respond promptly with on-brand, helpful, concise replies. Your goal is to convert curiosity into action by directing people to the appropriate URL: website for general inquiries, booking link for appointments, order/pricing link for purchases, or a custom link the admin has configured. Stay friendly, never push, and escalate hostile, legal, or genuinely ambiguous messages to the team instead of guessing.",
    default_schedule: "",
  },
  // Add future agents here:
  // { id: "liz_monday_cleanup", name: "Liz", icon: "📋", platform_agent_id: "monday", ... }
];

export const SCHEDULE_OPTIONS: { label: string; value: string }[] = [
  { label: "On-demand only", value: "" },
  { label: "Every weekday at 9 AM", value: "0 9 * * 1-5" },
  { label: "Every weekday at 6 PM", value: "0 18 * * 1-5" },
  { label: "Daily at 6 AM", value: "0 6 * * *" },
  { label: "Daily at 9 AM", value: "0 9 * * *" },
  { label: "Monday mornings (9 AM)", value: "0 9 * * 1" },
  { label: "Hourly during work hours (9–5, Mon–Fri)", value: "0 9-17 * * 1-5" },
];

export function presetById(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find((p) => p.id === id);
}
