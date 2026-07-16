// Pure contact-matching decision — no network, no I/O. An ambiguous match
// (>1 HubSpot contact sharing the same email) is treated as unmatched rather
// than guessed: an ambiguous attribution is worse than a skipped one.
import type { HubspotContact, MatchOutcome } from "./types";

export function matchContact(email: string | null, results: HubspotContact[]): MatchOutcome {
  if (!email) return { kind: "unmatched", reason: "no_email" };
  if (results.length === 0) return { kind: "unmatched", reason: "no_contact" };
  if (results.length > 1) return { kind: "unmatched", reason: "ambiguous" };
  return { kind: "matched", contact: results[0] };
}
