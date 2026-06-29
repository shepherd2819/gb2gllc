// app/proposals/[token]/page.tsx
import { getProposalByToken, markViewed } from "@/lib/sawyer/store";
import { renderProposalHtml } from "@/lib/sawyer/render";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await getProposalByToken(token);
  if (!proposal) notFound();
  await markViewed(token);
  const html = renderProposalHtml(proposal);
  // The rendered HTML is a full branded document built from escaped fields.
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
