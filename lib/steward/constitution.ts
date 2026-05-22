export function checkScope(toolName: string, actionScope: string[]): boolean {
  // Empty scope means the mission text is the only constraint (soft, via system prompt).
  // Non-empty scope enforces an explicit allowlist — only listed action classes pass.
  if (!actionScope || actionScope.length === 0) return true;
  return actionScope.includes(toolName);
}
