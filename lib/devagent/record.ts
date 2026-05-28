// lib/devagent/record.ts
//
// Phase 1: in-memory run log + a pretty-printed summary on stdout.
// Phase 2 will additionally persist a `devagent_runs` Supabase row.

import type { RunResult } from "./types";

export type RunRecord = {
  startedAt: string;
  endedAt?: string;
  task: string;
  branch: string;
  events: Array<{ at: string; type: string; payload: unknown }>;
};

export function newRecord(task: string, branch: string): RunRecord {
  return {
    startedAt: new Date().toISOString(),
    task,
    branch,
    events: [],
  };
}

export function recordEvent(rec: RunRecord, type: string, payload: unknown) {
  rec.events.push({ at: new Date().toISOString(), type, payload });
}

export function finalizeRecord(rec: RunRecord) {
  if (!rec.endedAt) rec.endedAt = new Date().toISOString();
}

/** Pretty-print a one-shot summary at the end of a run. */
export function printSummary(rec: RunRecord, result: RunResult) {
  const lines: string[] = [];
  lines.push(`\n━━━ Ada run summary ━━━`);
  lines.push(`Task:      ${rec.task}`);
  lines.push(`Branch:    ${rec.branch}`);
  lines.push(`Status:    ${result.status}`);
  if (result.ship) {
    lines.push(`PR:        ${result.ship.prUrl ?? "(none)"}`);
    lines.push(`Merged:    ${result.ship.merged ? "yes" : "no — needs-review"}`);
    lines.push(`Reason:    ${result.ship.evaluation.message}`);
  }
  lines.push(`Files:     ${result.filesChanged.length}`);
  if (result.tokensUsed != null) lines.push(`Tokens:    ${result.tokensUsed}`);
  if (result.costUsd != null) lines.push(`Cost USD:  ${result.costUsd.toFixed(4)}`);
  if (result.error) lines.push(`Error:     ${result.error}`);
  console.log(lines.join("\n"));
}
