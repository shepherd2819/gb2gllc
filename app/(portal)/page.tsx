import { redirect } from "next/navigation";

// home.gb2gllc.com → /dashboard
export default function PortalRoot() {
  redirect("/dashboard");
}
