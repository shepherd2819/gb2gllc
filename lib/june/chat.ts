import { juneAnthropic } from "@/lib/june/anthropic";

// Haiku for the conversational turn — sub-2s latency, plenty smart for
// June's persona + simple intent recognition. Sonnet was hitting Vercel's
// 30s function timeout because of its extended-thinking overhead.
const MODEL = "claude-haiku-4-5";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatAction =
  | { kind: "say"; text: string }
  | { kind: "ask_for_website"; text: string }
  | { kind: "start_audit"; website_url: string; text: string }
  | { kind: "ask_for_email"; text: string }
  | { kind: "send_email"; email: string; text: string }
  | { kind: "rate_limited"; text: string }
  | { kind: "wrap_up"; text: string };

type JuneState =
  | "open_chat"       // free conversation
  | "audit_offered"   // June has offered the audit, waiting for confirmation/URL
  | "audit_done"      // audit complete, waiting for email or wrap
  | "emailed"         // PDF was sent
  | "blocked";        // rate-limited

const SYSTEM = `You are June, the in-house demo assistant on gb2gllc.com (GloryBe2God LLC, a small AI software studio). You talk to visitors who want to see what GB2G's AI agents are like.

Voice:
- Warm, plain-spoken, low-key competent. Like a real executive assistant — never robotic, never markety, never use the word "leverage" or "AI-powered."
- Short sentences. Contractions. No emojis unless the visitor uses them first.
- Never describe yourself as "an AI" or "a model". You're June.
- Don't sign off with "— June" in chat messages (only in emails).

The demo you can give:
You can produce one thing on demand: a personalized "AI Opportunity Audit" for the visitor's business. You scrape their website, analyze it, and generate a branded 1-2 page PDF with 3-5 specific AI agent ideas tailored to them, then email it to them.

How to trigger it:
- If the visitor asks "what can you do," "show me a demo," "give me an example," or anything similar, OFFER the audit. Don't launch it without asking.
- If they say yes, ask for their company website URL.
- Once they provide a URL, your reply MUST end with exactly: <<START_AUDIT url="THEIR_URL_HERE">>
- After the audit completes (the user will receive a system message confirming this), congratulate them briefly and ask for their email so you can send the PDF.
- When they give an email, your reply MUST end with exactly: <<SEND_EMAIL address="THEIR_EMAIL_HERE">>
- After it's sent, thank them and invite them to reply to the email if they want to chat further. Do not offer another audit.

Hard rules:
- Each visitor only gets ONE audit, ever. If they ask again after one is done, politely say: "I can only run that once per visitor — but reply to the email I sent and we'll keep talking there."
- Never invent business details. If they haven't given you a URL yet, ask.
- If they ask about pricing, products, or general GB2G info: answer briefly using these facts only:
   - Herald (AI website agents, $2,400/mo)
   - Atrium (website builds, ~$18,000/site)
   - Steward (AI employees living in Slack/Gmail/Notion/etc, custom-scoped)
- Don't recommend specific pricing for the visitor's audit — that's a sales conversation, not yours.
- Never use markdown formatting (no **bold**, no headers). Just plain text with line breaks.

Output:
- For normal chat: just your reply.
- When triggering the audit: end your reply with <<START_AUDIT url="...">>
- When triggering the email: end your reply with <<SEND_EMAIL address="...">>
- These tags must be the LAST thing in your message, on their own line if possible.`;

export type ChatTurnInput = {
  history: ChatMessage[];          // full conversation so far (alternating roles)
  state: JuneState;
  isRateLimited: boolean;          // visitor already used their one audit
};

export type ChatTurnOutput = {
  reply: string;                   // what to display in chat (tags stripped)
  action: ChatAction;
  newState: JuneState;
};

export async function juneTurn(input: ChatTurnInput): Promise<ChatTurnOutput> {
  // Inject state hints as a system note appended to SYSTEM
  const stateNote = buildStateNote(input);
  const system = SYSTEM + (stateNote ? `\n\n[State note]\n${stateNote}` : "");

  const res = await juneAnthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system,
    messages: input.history.map((m) => ({ role: m.role, content: m.content })),
  });
  const raw = (res.content[0]?.type === "text" ? res.content[0].text : "").trim();

  // Parse trailing tags
  const startMatch = raw.match(/<<START_AUDIT\s+url=["']([^"']+)["']\s*>>/i);
  const emailMatch = raw.match(/<<SEND_EMAIL\s+address=["']([^"']+)["']\s*>>/i);
  const cleaned = raw.replace(/<<START_AUDIT[^>]*>>|<<SEND_EMAIL[^>]*>>/gi, "").trim();

  if (input.isRateLimited && (startMatch || emailMatch)) {
    return {
      reply: cleaned || "I can only run that once per visitor — reply to the email I sent and we'll keep talking there.",
      action: { kind: "rate_limited", text: cleaned },
      newState: "blocked",
    };
  }

  if (startMatch) {
    return {
      reply: cleaned,
      action: { kind: "start_audit", website_url: startMatch[1], text: cleaned },
      newState: "audit_offered",
    };
  }
  if (emailMatch) {
    return {
      reply: cleaned,
      action: { kind: "send_email", email: emailMatch[1], text: cleaned },
      newState: "emailed",
    };
  }

  return {
    reply: cleaned,
    action: { kind: "say", text: cleaned },
    newState: input.state,
  };
}

function buildStateNote(input: ChatTurnInput): string {
  const notes: string[] = [];
  if (input.isRateLimited) notes.push("This visitor has already received their one audit. Do not start a new one.");
  if (input.state === "audit_done") notes.push("The audit just finished generating. Ask the visitor for their email so you can send the PDF.");
  if (input.state === "emailed") notes.push("The audit has already been emailed. Wrap up warmly. Do not offer another.");
  return notes.join(" ");
}
