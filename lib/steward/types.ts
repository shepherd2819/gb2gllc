export type ToolContext = {
  token: Record<string, string>;
  clientId: string;
  runId: string;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
};

export type SystemPromptParams = {
  mission: string;
  company: string;
  datetime: string;
  memoryContext: string;
  playbookContext: string;
};

export type AgentDefinition = {
  platformId: string;
  displayName: string;
  buildSystemPrompt: (params: SystemPromptParams) => string;
  tools: AgentTool[];
};

export type ToolCallRecord = {
  toolName: string;
  input: unknown;
  output: string;
};

export type RunResult = {
  runId: string;
  status: "completed" | "failed";
  summary: string | null;
};
