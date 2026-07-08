// lib/analytics/adapters.ts
//
// Provider registry. Adding a provider = write the adapter file + register it
// here; callers (sync pipeline, admin test-connection route, chat tool
// assembly) resolve adapters exclusively through getAdapter.

import type { ProviderAdapter } from "@/lib/analytics/types";
import { spiroAdapter } from "@/lib/analytics/providers/spiro";
import { spiroMcpAdapter } from "@/lib/analytics/providers/spiro-mcp";
import { genericMcpAdapter } from "@/lib/analytics/providers/generic-mcp";

const REGISTRY: Record<string, ProviderAdapter> = {
  spiro: spiroAdapter,
  spiro_mcp: spiroMcpAdapter,
  generic_mcp: genericMcpAdapter,
};

export function getAdapter(provider: string): ProviderAdapter | null {
  return REGISTRY[provider] ?? null;
}
