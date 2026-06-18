// Composes the call opener. The AI disclosure ("AI assistant") and, when
// recording is on, the recording notice are COMPLIANCE-REQUIRED and enforced
// even when a client supplies a custom greeting override.

export type GreetingOpts = {
  businessName: string;
  agentName: string;
  recordingEnabled: boolean;
  override?: string | null;
};

export function composeGreeting(opts: GreetingOpts): string {
  const { businessName, agentName, recordingEnabled, override } = opts;
  const recordingClause = recordingEnabled ? " Just so you know, this call may be recorded." : "";

  if (override && override.trim()) {
    let g = override.trim();
    if (!/ai assistant/i.test(g)) {
      g += ` I'm ${agentName}, ${businessName}'s AI assistant.`;
    }
    return `${g}${recordingClause}`.trim();
  }

  const recording = recordingEnabled ? " — and just so you know, this call may be recorded" : "";
  return `Thanks for calling ${businessName}, this is ${agentName}, their AI assistant${recording}. How can I help?`;
}
