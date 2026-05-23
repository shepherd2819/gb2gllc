import { supabaseAdmin } from "@/lib/supabase";
import { ClientsPageClient } from "./ClientsPageClient";

export default async function ClientsPage() {
  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, name, email, company, status, created_at, last_signed_in_at, client_products(product, active)")
    .order("created_at", { ascending: false });

  return <ClientsPageClient initialClients={clients ?? []} />;
}
