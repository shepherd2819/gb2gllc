// app/(portal)/analytics/ChatPanel.tsx
"use client";
import { useRef, useState } from "react";
import { useToast } from "@/components/ui";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel({ conversationId, initialMessages }: { conversationId: string; initialMessages: Msg[] }) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  // Server-confirmed conversation id, used for every turn after the first.
  // The prop seeds it (page.tsx already ran getOrCreateConversation), and the
  // stream's first event re-confirms/replaces it — e.g. if this id ever
  // stopped resolving server-side, getOrCreateConversation would mint a fresh
  // one and we adopt that for subsequent turns instead of looping on a dead id.
  const conversationIdRef = useRef(conversationId);

  function dropTrailingEmptyAssistantBubble() {
    setMessages((m) => {
      const c = [...m];
      if (c.length && c[c.length - 1].role === "assistant" && c[c.length - 1].content === "") c.pop();
      return c;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/api/portal/analytics/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: conversationIdRef.current }),
      });
      if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let streamError: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const obj = JSON.parse(payload) as { token?: string; error?: string; conversationId?: string };
            if (typeof obj.conversationId === "string") {
              conversationIdRef.current = obj.conversationId;
            } else if (typeof obj.token === "string") {
              setMessages((m) => {
                const c = [...m];
                c[c.length - 1] = { role: "assistant", content: c[c.length - 1].content + obj.token };
                return c;
              });
            } else if (typeof obj.error === "string") {
              streamError = obj.error;
            }
          } catch {
            /* ignore keep-alive / non-JSON lines */
          }
        }
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      }
      if (streamError) {
        toast.error(streamError);
        dropTrailingEmptyAssistantBubble();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chat is unavailable right now.");
      dropTrailingEmptyAssistantBubble();
    } finally {
      setStreaming(false);
    }
  }

  return (
    <section className="ds-chat">
      <h2 className="section-title">Ask your data</h2>
      <div className="ds-chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="ds-chat-hint">Ask anything — e.g. &ldquo;How did June compare to May?&rdquo; or &ldquo;Which product drove the most revenue last quarter?&rdquo;</p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`ds-chat-msg ds-chat-msg--${m.role}`}>
              <span className="ds-chat-bubble">
                {m.content}
                {streaming && i === messages.length - 1 && m.role === "assistant" && <span className="ds-caret" aria-hidden />}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="ds-chat-compose">
        <textarea
          className="ds-textarea"
          rows={2}
          value={input}
          disabled={streaming}
          placeholder="Ask about your revenue, orders, customers…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="ds-btn ds-btn--primary"
          onClick={() => void send()}
          disabled={streaming || !input.trim()}
          data-loading={streaming || undefined}
        >
          {streaming ? "Thinking…" : "Send"}
        </button>
      </div>
    </section>
  );
}
