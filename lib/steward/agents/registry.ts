import { mondayAgent } from "./monday";
import type { AgentDefinition } from "@/lib/steward/types";

const registry: Record<string, AgentDefinition> = {
  monday: mondayAgent,
  // gmail, slack, notion, etc. — added as each is built
};

export function getAgent(platformId: string): AgentDefinition | null {
  return registry[platformId] ?? null;
}
