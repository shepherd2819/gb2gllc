import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Server-side client — full access, used in API routes only
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// Public client — used when anon key is sufficient
export const supabase = createClient(url, anonKey);

export type IntakeSession = {
  id: string;
  created_at: string;
  updated_at: string;
  source: string;
  state: Record<string, unknown>;
  submitted_at: string | null;
  notion_page_id: string | null;
  calendly_booking_id: string | null;
  expires_at: string;
};

export type IntakeFile = {
  id: string;
  session_id: string;
  name: string;
  content_type: string;
  size: number;
  storage_path: string | null;
  uploaded_at: string;
};
