// lib/devagent/ship.ts
//
// The `ship` custom tool, exposed to the orchestrator via an in-process MCP
// server. It commits + pushes the branch, opens a PR via the `gh` CLI, then
// re-runs verification + evaluates Gate 2 to decide auto-merge.
//
// Why re-verify inside ship: defense in depth. The orchestrator's verifier
// subagent already ran the checks; running them again here means a misbehaving
// model can't trick us into merging unverified code.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { evaluateScope } from "./guardrails";
import { captureDiff } from "./workspace";
import { verify } from "./verify";
import type { GuardrailsConfig, ShipDecision } from "./types";

const exec = promisify(execFile);

export type ShipDeps = {
  cwd: string;
  branch: string;
  guardrails: GuardrailsConfig;
  /** Optional sink for the structured decision; the wrapper uses this to surface ship results without parsing tool_results. */
  onDecision?: (d: ShipDecision) => void;
};

export function buildShipServer(deps: ShipDeps) {
  const shipTool = tool(
    "ship",
    "Commit the current changes on the active branch, push, open a PR, and auto-merge ONLY if verification is green AND the diff is within the configured low-risk scope. Always opens the PR; only the merge is gated. Returns the PR URL and merge decision.",
    {
      title: z.string().max(72).describe("PR title (imperative, < 72 chars)"),
      body: z.string().describe("PR body in Markdown — summarize what changed and why"),
      reviewer_must_fix: z
        .array(z.string())
        .default([])
        .describe("Must-fix items from the reviewer subagent. Empty array means READY TO SHIP."),
    },
    async (args) => {
      try {
        // Stage and commit any pending changes (no-op if clean).
        await exec("git", ["add", "-A"], { cwd: deps.cwd });
        const { stdout: status } = await exec("git", ["status", "--porcelain"], { cwd: deps.cwd });
        if (status.trim().length > 0) {
          await exec("git", ["commit", "-m", args.title], { cwd: deps.cwd });
        }

        // Push the branch.
        await exec("git", ["push", "-u", "origin", deps.branch], { cwd: deps.cwd });

        // Open the PR via gh; capture the URL it prints on the last line.
        const { stdout: prOut } = await exec(
          "gh",
          ["pr", "create", "--base", "main", "--head", deps.branch, "--title", args.title, "--body", args.body],
          { cwd: deps.cwd }
        );
        const prUrl = prOut.trim().split("\n").pop() ?? "";

        // Authoritative re-check before merging.
        const { changes, packageJsonChanged } = await captureDiff(deps.cwd);
        const verifyResult = await verify(deps.cwd);

        const evaluation = evaluateScope({
          changes,
          verifyPassed: verifyResult.ok,
          reviewerMustFix: args.reviewer_must_fix,
          packageJsonDepsChanged: packageJsonChanged,
          cfg: deps.guardrails,
        });

        let merged = false;
        if (evaluation.eligible) {
          await exec(
            "gh",
            ["pr", "merge", "--squash", "--delete-branch", prUrl],
            { cwd: deps.cwd }
          );
          merged = true;
        } else {
          await exec("gh", ["pr", "edit", prUrl, "--add-label", "needs-review"], { cwd: deps.cwd }).catch(
            () => undefined
          );
          await exec(
            "gh",
            ["pr", "comment", prUrl, "--body", `Auto-merge denied: ${evaluation.message}`],
            { cwd: deps.cwd }
          ).catch(() => undefined);
        }

        const decision: ShipDecision = { prUrl, merged, evaluation };
        deps.onDecision?.(decision);

        return {
          content: [
            {
              type: "text" as const,
              text: `${merged ? "Merged" : "PR opened (needs-review)"}: ${prUrl}\n${evaluation.message}`,
            },
          ],
          structuredContent: decision,
        };
      } catch (e) {
        const err = e as Error;
        return {
          content: [{ type: "text" as const, text: `ship failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: "devagent",
    version: "0.1.0",
    tools: [shipTool],
  });
}
