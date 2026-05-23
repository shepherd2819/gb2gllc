import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  const returnTo = next.startsWith("/") ? next : "/dashboard";
  const url = await getSignInUrl({ returnTo });
  redirect(url);
}
