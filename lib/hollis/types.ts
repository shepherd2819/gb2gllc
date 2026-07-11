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
  order_ops_enabled?: boolean;
  spiro_source_id?: string | null;
  slack_channel_id?: string | null;
};

export type CapturedFields = Record<string, string | number | boolean | null>;

export type OrderStatus =
  | "pending" | "awaitingConfirmation" | "confirmed" | "rescheduled"
  | "cancelled" | "inProgress" | "appointmentCompleted" | "editing" | "delivered";

export interface OrderCard {
  orderId: string;
  trackingCode: string;
  status: OrderStatus | string;
  addressText: string;
  arrivalWindowStart: string | null;
  arrivalWindowEnd: string | null;
  photographerName: string | null;
  agentId: string;
}

export interface SpiroAgent {
  agentId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
}

export interface SpiroCtx {
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer" | "x-api-key";
}

export type EscalationType = "reschedule" | "new_order" | "cancel";

export interface EscalationInput {
  type: EscalationType;
  clientId: string;
  lineId: string;
  slackChannel: string | null;
  staffEmail: string | null;
  callId?: string | null;
  retellCallId?: string | null;
  callerNumber?: string | null;
  agentId?: string | null;
  order?: OrderCard | null;
  verified: boolean;
  fields: Record<string, unknown>;
  staffContext?: Record<string, unknown>;
}
