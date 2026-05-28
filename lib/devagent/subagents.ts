// lib/devagent/subagents.ts
//
// Programmatic subagent definitions passed to the SDK's `agents` option.
// Per the Claude Agent SDK docs, each entry must include `description` (used
// by the orchestrator to decide when to dispatch) and `prompt` (the
// subagent's system prompt). `tools` whitelists what the subagent can use.

type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
};

const SCOUT_PROMPT = `You are the scout. Your sole job is to map the part of the codebase relevant to the task.
- Use Read, Grep, and Glob only.
- Identify: the files that will change, the conventions in play (auth, supabase, migrations, *Manager+API pattern), and any existing similar feature.
- Return a concise structured summary: file paths, patterns, and ≤5 lines on conventions.
- Do not propose code. Do not edit anything.`;

const ARCHITECT_PROMPT = `You are the architect. Read the scout's report and the task, then produce a precise implementation plan.
- List files to create / modify (with brief direction), data flow, and whether a numbered Supabase migration is needed.
- Follow GB2G conventions: requireAdmin / portal-auth on API routes, supabaseAdmin (service role) for app data, numbered migrations (supabase/migrations/NNN_*.sql), the *Manager+API admin pattern.
- Honor AGENTS.md: this Next.js is non-standard — read the relevant doc in node_modules/next/dist/docs/ before designing anything Next-specific.
- Output the plan as a numbered task list. Do not write code.`;

const CODER_PROMPT = `You are the coder. Read the architect's plan and implement it.
- Follow it exactly. Match existing style (vanilla JS bent, no Tailwind, no UI libraries).
- Use Read / Edit / Write / Bash. Confirm types pass and the build succeeds locally as you go.
- If a migration is needed, place it as supabase/migrations/NNN_*.sql with the standard "service role only" RLS footer.
- Stop when the plan is done. Do not invent extra scope.`;

const VERIFIER_PROMPT = `You are the verifier. Run the project's verification commands in this order and report results:
1. \`npm run typecheck\` (or \`npx tsc --noEmit\` if no script)
2. \`npm run build\` (or \`npx next build\`)
3. \`npm run lint\` if defined
4. \`npm run test\` if defined

Return a structured report: PASS/FAIL per step, last ~50 lines of any failing output. Do not edit code; only run commands.`;

const REVIEWER_PROMPT = `You are the reviewer. Run \`git diff main...HEAD\` and assess the change.
- Look for bugs, security issues (auth bypass, leaking secrets), and convention breaks (RLS misuse, hardcoded URLs, missing requireAdmin, Tailwind sneaking in, UI libs).
- Output a structured list:
    must_fix: [ ... ]   # only items that block ship
    nice_to_have: [ ... ]
- If must_fix is empty, end your response with the literal phrase "READY TO SHIP".`;

export function buildAgents(): Record<string, AgentDefinition> {
  return {
    scout: {
      description: "Map the part of the codebase relevant to a task. Read-only.",
      prompt: SCOUT_PROMPT,
      tools: ["Read", "Grep", "Glob"],
      model: "claude-sonnet-4-6",
    },
    architect: {
      description: "Produce a precise implementation plan for the task, grounded in repo conventions.",
      prompt: ARCHITECT_PROMPT,
      tools: ["Read", "Grep", "Glob"],
      model: "claude-opus-4-7",
    },
    coder: {
      description: "Implement an approved architect plan, editing files and running quick sanity checks.",
      prompt: CODER_PROMPT,
      tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],
      model: "claude-sonnet-4-6",
    },
    verifier: {
      description: "Run typecheck, build, lint, and test commands; return structured results.",
      prompt: VERIFIER_PROMPT,
      tools: ["Bash", "Read"],
      model: "claude-haiku-4-5-20251001",
    },
    reviewer: {
      description: "Review a diff for bugs, security issues, and convention breaks; return must-fix list.",
      prompt: REVIEWER_PROMPT,
      tools: ["Read", "Grep", "Bash"],
      model: "claude-opus-4-7",
    },
  };
}
