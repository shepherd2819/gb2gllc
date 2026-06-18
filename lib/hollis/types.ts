export type VoiceProfile = "female" | "male";
export type BookingMode = "email" | "crm" | "both";
export type LineStatus = "provisioning" | "active" | "paused" | "released";
export type CallOutcome =
  | "booked"
  | "booking_request"
  | "qualified_lead"
  | "message"
  | "transfer"
  | "no_action";

export type HollisLine = {
  id: string;
  client_id: string;
  phone_number: string;
  retell_agent_id: string | null;
  retell_number_id: string | null;
  voice_profile: VoiceProfile;
  agent_name: string;
  voice_id: string | null;
  greeting_override: string | null;
  persona: Record<string, unknown>;
  hours: Record<string, unknown>;
  services: string[];
  escalation_number: string | null;
  booking_mode: BookingMode;
  booking_email: string | null;
  crm_config: Record<string, unknown>;
  recording_enabled: boolean;
  status: LineStatus;
};

export type CapturedFields = Record<string, string | number | boolean | null>;
