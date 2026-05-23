import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function GET() {
  const headersList = await headers();
  const xUrl = headersList.get("x-url") ?? "";
  const isAdmin = xUrl.includes("admin.");
  const returnPathname = isAdmin ? "/admin" : "/dashboard";
  const url = await getSignInUrl({ returnTo: returnPathname });
  redirect(url);
}
