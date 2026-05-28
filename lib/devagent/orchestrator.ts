// lib/devagent/orchestrator.ts
//
// Builds the orchestrator's system prompt. We use the Claude Agent SDK's
// "claude_code" preset (so all the harness tooling guidance comes for free)
// and append GB2G-specific project rules.

const PROJECT_RULES = `## GB2G Project Rules

You are operating on the GB2G repo (a Next.js 16.2.6 + React 19 + TypeScript monolith hosting marketing, portal, and admin surfaces).

CRITICAL — this is NOT the Next.js you know from training data:
- Middleware lives at \`proxy.ts\` in the repo root, not \`middleware.ts\`. (Off-limits to edits.)
- Route params are async: \`const { id } = await params\` (params is a Promise).
- There is NO root \`app/layout.tsx\`; route groups (\`(admin)\`, \`(portal)\`, marketing) each provide their own \`<html><head><body>\` shell.
- Always read the relevant guide in \`node_modules/next/dist/docs/\` before writing Next-specific code.

Auth & DB:
- API routes use \`const guard = await requireAdmin(); if (!guard.ok) return guard.response;\` (from lib/admin-auth).
- Portal routes use \`getPortalClientId()\` / \`isClientOwner()\` from lib/portal-auth.
- Supabase is service-role-only: import \`supabaseAdmin\` from \`@/lib/supabase\` in server code. Never the anon client.

DB changes:
- A new numbered migration: \`supabase/migrations/NNN_*.sql\`.
- Standard footer: \`ALTER TABLE … ENABLE ROW LEVEL SECURITY;\` + a "service role only" policy.

Style:
- No Tailwind, no UI libraries. Admin/portal load static CSS from \`public/admin/admin.css\` / \`public/portal/portal.css\`.
- Marketing site is vanilla HTML in \`public/*.html\` served by route handlers.

Agent-feature pattern:
- A \`*Manager.tsx\` client component under \`app/(admin)/clients/[id]/\` ↔ API routes under \`app/api/admin/...\` using \`requireAdmin\` + \`supabaseAdmin.upsert(..., { onConflict })\`.
- Audit via \`logEvent()\` → \`client_logs\` (lib/logger).

You have specialist subagents available via the Agent tool:
- \`scout\`: map relevant code (read-only).
- \`architect\`: produce a precise implementation plan.
- \`coder\`: implement the plan.
- \`verifier\`: run typecheck / build / lint / test.
- \`reviewer\`: review the diff before ship.

For any non-trivial task:
1. Dispatch \`scout\` first.
2. Dispatch \`architect\` with the scout's report.
3. Dispatch \`coder\` with the architect's plan.
4. Loop \`coder\` ⇄ \`verifier\` until verification is green (max 3 cycles).
5. Dispatch \`reviewer\`.
6. Once verification is green AND reviewer says READY TO SHIP, call the \`ship\` tool with an empty \`reviewer_must_fix: []\` array.

If verification stays red after 3 cycles, call \`ship\` anyway with \`reviewer_must_fix\` populated — it will open a PR labeled \`needs-review\` (no auto-merge).
`;

export function buildOrchestratorSystemPrompt() {
  return {
    type: "preset" as const,
    preset: "claude_code" as const,
    append: PROJECT_RULES,
  };
}
