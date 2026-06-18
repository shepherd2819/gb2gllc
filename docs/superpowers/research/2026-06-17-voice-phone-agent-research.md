# Building a Human-Sounding Phone Agent for GB2G — Research & Architecture

> Scope: an inbound, multi-tenant AI phone receptionist ("answers the phone like a real person") sold by GB2G to small businesses. Stack of record: Next.js 16 on Vercel + Supabase + Inngest + Anthropic Claude. All pricing/latency figures are as of mid-2026 and should be re-verified at build time — this market re-prices quarterly.
>
> _Produced 2026-06-17 from a 26-agent research workflow (13 web-research streams + 12 adversarial fact-checks + synthesis)._

---

## 0. TL;DR & Recommendation

- **Buy the realtime media loop, own the brain and the data.** Use **Retell AI** as the managed voice platform (it owns telephony + STT + TTS + the WebSocket audio loop), with **Anthropic Claude (Haiku 4.5)** as the reasoning brain via Retell's native Claude support, and **Cartesia Sonic** as the voice. GB2G builds the white-label tenant portal, per-client config, tool-call webhooks, and post-call data layer itself. This is the only path that keeps Claude as the brain, keeps all transcripts/outcomes in Supabase, and ships in weeks not months. ([Retell pricing](https://www.retellai.com/pricing), [Retell webhooks](https://docs.retellai.com/features/webhook-overview))
- **Why not full DIY (LiveKit/Pipecat) yet:** below ~10K–50K minutes/month the engineering cost ($150K–$300K + a persistent-worker ops surface outside Vercel) dwarfs the per-minute savings. Architect for portability so you can migrate later. ([LiveKit guide](https://www.forasoft.com/blog/article/livekit-ai-agents-guide))
- **Why not Vapi as primary:** functionally equivalent and more flexible, but ~600ms-vs-1,000ms+ default latency disadvantage and HIPAA at **$2,000/mo** add-on vs Retell's bundled compliance. Vapi is the named **fallback** (its `assistant-request` webhook is a clean multi-tenant pattern and it has explicit BYOK for Anthropic). ([Vapi pricing](https://vapi.ai/pricing), [Vapi BYOK](https://docs.vapi.ai/customization/provider-keys))
- **Headline economics:** wholesale all-in **~$0.13–0.16/min** (Retell infra $0.055 + Claude Haiku ~$0.005 + Cartesia ~$0.015 + telephony). Resell at **$0.25–0.40/min** or as $199/$399/$699 monthly tiers → **60–75% gross margin**. ([Retell pricing](https://www.retellai.com/pricing))
- **Expected latency:** realistically **~600–900ms** voice-to-voice on Retell+Claude+Cartesia. The human "natural" gap is **~100–300ms** ([PNAS turn-taking](https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/)); you will not hit that, so **latency masking and conversation design do the heavy lifting of "sounding human,"** not raw speed. **Critical constraint: the realtime loop cannot run on Vercel** (no WebSocket support, even with Fluid Compute) — Retell hosts it; Vercel only handles short webhooks. ([Vercel WebSocket KB](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections))

---

## 1. How a Voice Agent Actually Works

There are two architectures. For GB2G, **cascaded** wins decisively.

### Cascaded (STT → LLM → TTS) — RECOMMENDED
Each stage is a separate, swappable service. Text exists at every boundary (great for compliance audit, debugging, and using Claude). This is the production standard in 2026 and the only way to use Claude, which has **no native voice API** — confirmed: every Claude model is "text and image input, text output." ([Anthropic models](https://platform.claude.com/docs/en/about-claude/models/overview), [verification](https://github.com/anthropics/anthropic-sdk-python/issues/1198))

### Native Speech-to-Speech (S2S) — NOT for GB2G v1
One model ingests audio and emits audio (OpenAI gpt-realtime-2, Gemini Live, Amazon Nova 2 Sonic). Lower latency in theory, but: locks out Claude, weaker/less-auditable tool calls, no intermediate transcripts (compliance gap), and **PSTN's 8kHz G.711 audio neutralizes most of the prosodic advantage**. ([S2S vs cascade](https://hamming.ai/blog/are-speech-to-speech-models-ready-to-replace-cascade-models))

### Data-flow of one inbound call

```
   Caller's phone
        │  (PSTN, 8kHz μ-law G.711)
        ▼
┌──────────────────────────┐
│  Telephony / Carrier      │  Twilio / Telnyx number → SIP/Media stream
│  (number, STIR/SHAKEN)    │
└───────────┬───────────────┘
            │  audio frames over WebSocket  (THIS LOOP CANNOT RUN ON VERCEL)
            ▼
┌───────────────────────────────────────────────────────────────┐
│  MANAGED VOICE PLATFORM (Retell)  — hosts the realtime loop      │
│                                                                  │
│   ┌─────────┐   partial text   ┌──────────────┐   tokens        │
│   │  STT    │ ───────────────► │  LLM (Claude) │ ──────────┐     │
│   │Deepgram │                  │  Haiku 4.5    │           │     │
│   │ + turn  │ ◄─ barge-in ──── │  +tool calls  │           ▼     │
│   │ detect  │                  └──────┬────────┘     ┌──────────┐│
│   └─────────┘                         │ tool call    │   TTS    ││
│        ▲                              ▼ (webhook)     │ Cartesia ││
│        │                     ┌────────────────┐       │  Sonic   ││
│        │                     │  GB2G backend   │       └────┬─────┘│
│        │                     │  (Vercel route) │            │      │
└────────┼─────────────────────┤  Supabase R/W   │────────────┼──────┘
         │   synthesized audio  └────────────────┘            │
         └──────────────────────────────────────◄─────────────┘
                                   audio back to caller
        │
        ▼  (call ends)
   end-of-call webhook → Vercel → Inngest → Supabase (transcript, outcome, ticket)
```

### The latency budget that makes or breaks "human"

Humans answer with a **~100–300ms** inter-turn gap (cross-linguistic median ~100–200ms); delays >500ms read as "slow" and >1,000ms read as "is the line dead?" ([PNAS](https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/), [AssemblyAI 300ms rule](https://www.assemblyai.com/blog/low-latency-voice-ai)). The widely-quoted "200–500ms feels natural" is vendor-softened; **300ms is the real upper edge of "natural," 800ms is the practical production target.**

| Stage | Realistic (managed cascade) | Optimized self-host |
|---|---|---|
| Endpointing / turn detection | 150–400ms | 75–200ms |
| STT (streaming, to usable text) | 100–250ms | 100–150ms |
| LLM TTFT | 300–600ms (Claude Haiku ~597ms) | 200–400ms |
| TTS TTFB | 150–290ms (Cartesia ~188ms P50 real-world) | 40–100ms |
| Network / orchestration | 50–150ms | 20–50ms |
| **Voice-to-voice total** | **~700–1,200ms** | **~400–700ms** |

Industry **median across 4M+ real calls is 1.4–1.7s P50** ([Hamming](https://hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it)) — meaning a well-tuned 700–900ms agent is already top-decile. **The largest single lever is LLM TTFT; the second is endpointing.** Claude Haiku 4.5 at ~597ms TTFT is borderline — mask it with conversation design (Section 2). ([latency benchmarks](https://www.kunalganglani.com/blog/llm-api-latency-benchmarks-2026))

---

## 2. The "Sound Like a Real Person" Playbook

**This is the section that matters most.** Naturalness is a *systems* problem — endpointing, interrupt latency, fillers, masking, persona — far more than TTS quality. The fix is mostly prompt engineering + platform tuning, not buying a fancier voice.

### 2.1 Voice selection & cloning
- **Default to Cartesia Sonic 3.5** — top of Artificial Analysis naturalness ELO among production models *and* lowest real-world latency (188ms P50 TTFA). ([Cartesia launch](https://www.cartesia.ai/launch/), [Coval benchmark](https://www.coval.ai/blog/best-text-to-speech-providers-in-2026-how-to-choose-(and-why-vendor-benchmarks-lie)/))
- **ElevenLabs Flash v2.5** for premium/branded voices and per-tenant voice cloning (richest expressiveness; consistent 28ms IQR). Offer as a paid upsell. ([ElevenLabs Flash](https://elevenlabs.io/blog/meet-flash))
- **Per-tenant voice cloning:** Cartesia Instant (3–10s sample) for fast onboarding; ElevenLabs Professional Clone (30-min consent audio) as a premium SKU. **Do not use ElevenLabs v3 for live calls** — it is not streaming-optimized. ([naturalness comparison](https://futureagi.com/blog/elevenlabs-vs-cartesia-tts-2026/))
- **Request μ-law/8kHz telephony output explicitly** in the API call rather than transcoding after the fact.

### 2.2 Sub-second latency techniques
1. **Stream at every boundary** — partial STT → LLM, LLM tokens → TTS, TTS chunks → caller. Non-negotiable; saves 1,000–2,000ms vs batch. ([streaming case study](https://medium.com/@reveorai/solving-voice-ai-latency-from-5-seconds-to-sub-1-second-responses-d0065e520799))
2. **Sentence-chunk the TTS** — fire TTS on the first complete sentence (split on `[.!?]`, min ~10 chars), not the whole LLM response. ([Deepgram chunking](https://developers.deepgram.com/docs/tts-text-chunking))
3. **Claude prompt caching** — cache the system prompt + tool schemas (`cache_control: ephemeral`, 1-hour TTL). 90% cost cut on cached tokens and lower TTFT. Note Haiku 4.5 needs **≥4,096 tokens** to trigger caching. ([Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))
4. **Disable Claude extended/adaptive thinking on voice turns** — reasoning mode pushes TTFT to 8–200s and silently destroys calls. ([LLM-for-voice](https://softcery.com/lab/ai-voice-agents-choosing-the-right-llm))
5. **Cap output to 50–150 tokens/turn**, low temperature (0.2–0.3).
6. **Pre-cache fixed phrases** (greeting, hold, closing) as audio for near-zero TTS latency.

### 2.3 Barge-in / interruption — treat as a *policy*, not a toggle
Total handle time should be **<150ms**: TTS flush within ~60ms, LLM cancel (AbortController) within ~40ms. Classify caller speech into **5 categories before acting**: true-correction (stop & accept), backchannel "yeah/okay" (continue), accidental noise (resume), DTMF (route), silence-timeout (reprompt). Using raw energy VAD conflates backchannels with interruptions and makes the agent twitchy. ([barge-in pipeline](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/), [interruption runbook](https://hamming.ai/resources/voice-agent-interruption-handling-runbook))

**Mid-tool-call rule:** idempotent reads (availability lookup) may finish in background; mutations (booking, payment) must be cancelled only if the new utterance contradicts them, and wrapped in `disallow_interruptions()` during the write.

### 2.4 Endpointing / turn detection
Use a **neural/semantic turn detector**, not an 800ms silence timer (which alone adds ~1s of dead air). Retell ships one out of the box; Deepgram Flux fuses turn detection into the STT model (~30% fewer false interruptions). Phone audio needs tuned thresholds: ~300–600ms silence for conversation, higher confidence to reject background noise. ([Deepgram Flux](https://deepgram.com/learn/introducing-flux-conversational-speech-recognition), [LiveKit turn detection](https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection))

### 2.5 Backchannels, fillers & disfluencies
- **2–4 disfluencies per turn** is the sweet spot — too few = robotic, too many = glitchy. Self-monitoring prompt instruction: *"If a turn comes out as one clean polished sentence, add a filler and try again."* ([Vapi prompting guide](https://docs.vapi.ai/prompting-guide))
- Role-match the vocabulary: receptionist → "um," "let me see"; clinical → "one moment," "let me check."
- Emit brief backchannels ("mm-hmm," "got it") on detected backchannel speech instead of stopping the turn.

### 2.6 Latency masking — the highest-ROI trick
Fire a **context-aware interim phrase on the tool-call *start* event**, not from the LLM ("Let me pull that up…", "One moment while I check"). This plays with near-zero latency and hides 1–10s of API time. Sierra explicitly avoids gaming TTFA with generic filler and uses this pattern. Keep masks <5 words so they don't collide with the arriving response. ([Sierra latency](https://sierra.ai/blog/voice-latency))

### 2.7 Prosody & spoken-form normalization
- Drive pacing with commas/periods in LLM output; avoid em-dashes and cross-provider SSML quirks.
- **Add a normalization layer between LLM and TTS:** `$42.50` → "forty-two dollars and fifty cents," `(831) 239-8123` → "eight three one, two three nine…," `10am` → "ten a m." Raw text to TTS is a top robotic tell. ([prompting guide](https://docs.vapi.ai/prompting-guide))

### 2.8 Persona & script design
- Transparent-but-warm beats fake-human: *"Hi, this is Alex, [Business]'s AI assistant — how can I help?"* Research shows over-claiming humanity triggers suspicion (the "uncanny valley of personality"). ([Talkdesk voice design](https://www.talkdesk.com/blog/voice-design/))
- **Turn budgets:** appointment booking 5–7 turns, lead qualification 8–12 turns — prevents the "survey interrogation" feel.
- Progressive silence handling: at 10–15s say "Still there?", only end after no response. Never end on an interruption.

### 2.9 The AI "tells" to eliminate
| Tell | Fix |
|---|---|
| Perfect cadence, zero disfluency | 2–4 fillers/turn, frequency-governed |
| Over-empathy ("I understand you're upset") | solution-focused ("I can fix that right now") |
| Instant <200ms responses | add 100–150ms "thinking" delay for clinical/financial |
| "I didn't catch that" | targeted reprompt: "Was that Monday or Tuesday?" |
| Reading lists/bullets aloud | "first… then… finally…" |
| Laughter/emotion every turn | cap at ~1-in-4 turns |

---

## 3. The Stack, Layer by Layer

### (a) Telephony

| Provider | Inbound $/min | Multi-tenant | Latency | Notes |
|---|---|---|---|---|
| **Twilio** | $0.0085 + $1.15/mo DID | **Subaccounts (full REST API)** | ~150–300ms setup | Most reliable, native subaccounts = cleanest tenant isolation ([pricing](https://www.twilio.com/en-us/voice/pricing/us)) |
| Telnyx | ~$0.004–0.007 | Managed Accounts (sales-gated) | p95 SIP ~118ms | 40–50% cheaper, private backbone ([pricing](https://telnyx.com/pricing/voice-api)) |
| Plivo | $0.0055 + $0.50/mo DID | none native | <1s | Free recording, cheapest numbers |

**Pick:** Whatever your platform brokers. With Retell, use Retell-managed Twilio numbers ($2/mo) initially; for cost at scale, BYO a Telnyx SIP trunk. **Each tenant gets its own local DID** for answer-rate and routing. Verify **STIR/SHAKEN attestation level in writing per number block** — it is account-specific, not automatic.

### (b) STT / ASR + endpointing

| Provider | $/min (stream) | Latency | Turn detection | 8kHz μ-law native |
|---|---|---|---|---|
| **Deepgram Nova-3 + Flux** | $0.0048–0.0065 | 247ms P50 TTCT | **Model-fused (Flux)** | No (resample) |
| AssemblyAI Universal-3 Pro | $0.0075 (session-billed) | 568ms P50 TTCT | Hybrid acoustic+semantic | **Yes (only one)** |
| Soniox v5 | $0.002 | 249ms TTFS | Semantic (v5) | unconfirmed |

**Pick:** **Deepgram Flux** for latency-first voice agents (lowest TTCT, best fused turn detection, simple per-second billing). It's also Retell's default. ([Deepgram pricing](https://deepgram.com/pricing), [AssemblyAI benchmarks](https://www.assemblyai.com/benchmarks)) AssemblyAI is the accuracy alternative if entity capture (medical/legal) dominates. **A/B on your own call recordings** — vendor WER benchmarks diverge wildly.

### (c) TTS / voice

| Provider | $/min | Real-world TTFA P50 | Naturalness | Phone audio |
|---|---|---|---|---|
| **Cartesia Sonic 3.5** | ~$0.015–0.027 | 188ms | Top-tier ELO | 8kHz supported |
| ElevenLabs Flash v2.5 | $0.043–0.088 | 264–288ms (28ms IQR) | Best expressive/cloning | 8kHz supported |
| Deepgram Aura-2 | ~$0.009–0.026 | 313ms | Good, English-focused | on-prem option |

**Pick:** **Cartesia Sonic 3.5** default (latency + naturalness + cost), **ElevenLabs Flash** as premium/clone upsell. **Avoid** OpenAI TTS-1-HD (2,295ms P50 — unusable) and Rime Arcana (450ms P50). ([Coval benchmark](https://www.coval.ai/blog/best-text-to-speech-providers-in-2026-how-to-choose-(and-why-vendor-benchmarks-lie)/))

### (d) The LLM brain — how Claude fits (it has no native voice)

Claude is the **text reasoning layer** inside the cascade. The platform does STT → sends text to Claude → streams Claude's tokens to TTS. Tool calls (book, qualify, transfer, take-message) are standard Claude tool use executed via webhook to GB2G's backend.

| Model | TTFT | $/MTok in/out | Voice-bench | Use |
|---|---|---|---|---|
| **Claude Haiku 4.5** | ~300–600ms | $1 / $5 | 98% (Daily.co) | **Default brain** |
| Claude Sonnet 4.6 | 850ms–1.36s | $3 / $15 | 100% | Complex booking/healthcare, masked w/ filler |
| Gemini 3 Flash | ~300–450ms | $0.25 / $1.50 | weaker instruction-following | cost tier only |

**Pick:** **Claude Haiku 4.5** for all standard turns; route complex flows to **Sonnet 4.6** with a verbal filler to mask its higher TTFT. Use **`strict: true` on all tool schemas** (grammar-constrained JSON — booking/CRM payloads never malform), the **`fine-grained-tool-streaming-2025-05-14`** header, and **prompt caching**. ([model overview](https://platform.claude.com/docs/en/docs/about-claude/models/overview), [tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview), [Twilio+Claude function calling](https://www.twilio.com/en-us/blog/developers/tutorials/product/function-calling-twilio-voice-anthropic-claude-integration))

### (e) Orchestration: managed vs self-host

| | Managed (Retell/Vapi) | Self-host (LiveKit/Pipecat) |
|---|---|---|
| Time-to-launch | days–weeks | 3–6 months |
| Realtime loop host | vendor | your persistent worker (Fly/Railway) |
| Cost overhead | $0.05–0.07/min | infra + 0.5–1 FTE ongoing |
| Control | per-call config, BYO LLM | total |
| Break-even | — | ~10K–50K min/mo |

**Pick:** Managed (Retell) now; **LiveKit Agents (TypeScript SDK, GA)** is the migration target at scale — same agent code runs Cloud or self-hosted Kubernetes; native SIP; first-class Node. ([LiveKit agents-js](https://github.com/livekit/agents-js))

### (f) Native S2S alternative — when to prefer
Only build an "ultra-premium" S2S tier (OpenAI gpt-realtime-2, **$32/$64 per 1M audio tokens ≈ ~$0.10/min balanced**, or Gemini Live at ~$0.023/min) if sub-400ms feel becomes a paid differentiator and you accept losing Claude, weaker auditability, and (for OpenAI) **no HIPAA eligibility**. Not for v1. ([gpt-realtime-2 pricing](https://developers.openai.com/api/docs/models/gpt-realtime-2), [verification](https://callsphere.ai/blog/vw2c-openai-realtime-cost-per-minute-math-2026))

---

## 4. Build vs Buy — Decision Matrix

| | (A) Fully managed (Retell/Vapi) | (B) LiveKit/Pipecat self-host | (C) Twilio ConversationRelay + your backend |
|---|---|---|---|
| Owns realtime loop | Platform | Your persistent worker | Twilio (STT/TTS), your LLM |
| Claude support | Native (Retell) / BYOK (Vapi) | Full | BYO LLM via WebSocket |
| White-label fit | Build portal on their API | Total | Build portal |
| Cost/min all-in | $0.13–0.31 | $0.04–0.10 (+infra/ops) | $0.07/min CR + voice + your LLM |
| Latency | Retell ~600ms / Vapi ~1s | 400–700ms | ~500ms median, 725ms p95 |
| Compliance | HIPAA bundled (Retell) | DIY BAAs w/ every vendor | HIPAA-eligible, PCI |
| Time-to-launch | **days–weeks** | months | weeks |
| Vercel-compatible | **Yes (webhooks only)** | No (needs persistent host) | **Mostly** (still needs a long-lived WS server for the LLM side) |

**Primary: (A) Retell AI.** Lowest time-to-market, native Claude, ~600ms latency, bundled SOC2/HIPAA, clean per-agent webhooks and dynamic-variable injection for multi-tenant. ([Retell](https://www.retellai.com/pricing))

**Fallback: (A') Vapi** if you need per-tenant LLM/provider choice or hit a Retell limitation — its `assistant-request` webhook routes per-phone-number to per-tenant configs and BYOK passes Anthropic through at cost. ([Vapi events](https://docs.vapi.ai/server-url/events))

**Future: (B) LiveKit** at scale. **Avoid (C)** as primary — ConversationRelay still requires you to host a long-lived WebSocket server for the LLM leg, which Vercel can't do, so it adds infra without removing the hard problem.

---

## 5. Recommended Architecture for the GB2G Stack

### Why the realtime loop can't live in Vercel
**Confirmed:** Vercel functions cannot act as a WebSocket server — *"Vercel Functions do not support acting as a WebSocket server,"* and **Fluid Compute does not change this** (Vercel team confirmed). Edge max stream is 300s; Node max is 300–1800s — all incompatible with an open-ended phone call. ([Vercel KB](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections), [community confirmation](https://community.vercel.com/t/does-vercel-support-websockets-now-that-we-have-fluid-compute/27205))

**So Retell hosts the media loop.** Vercel only serves short HTTPS webhooks: (1) a synchronous **tool-call** endpoint (≤10s budget) and (2) an async **post-call** endpoint that returns 200 immediately and hands off to Inngest.

### Agent name
Following the fleet convention (Avery, Holt, Iris, June, Maya, Nora, Reese, Vera, Wren — human first names), the phone agent is proposed as **Hollis** (a warm, neutral receptionist name; not colliding with existing `holt`). _Name not yet locked — owner decision._

### ASCII architecture (GB2G-specific)

```
 Caller ──PSTN──► Retell (loop: Deepgram→Claude Haiku→Cartesia) ──► Caller
                        │                         │
        tool call (≤10s)│                         │ end-of-call / call_analyzed
                        ▼                         ▼
        app/api/hollis/tool/route.ts     app/api/hollis/webhook/route.ts
                 │  (Supabase read:               │ (return 200 fast)
                 │   availability, FAQ,            ▼
                 │   client config)        inngest.send("hollis/call.analyzed")
                 ▼                                 │
            Supabase (RLS)                         ▼
         clients · hollis_lines           lib/inngest fn → Supabase write:
         hollis_kb                          hollis_calls · client_logs · tickets
                                            + Notion/CRM/email side-effects
```

### New module, tables, routes, files (GB2G conventions)

**Migration `supabase/migrations/027_hollis.sql`** (next number is 027):
- `hollis_lines` — one AI phone line per client business: `id, client_id FK→clients ON DELETE CASCADE, phone_number UNIQUE, e164, retell_agent_id, voice_id, persona JSONB, dynamic_variables JSONB, hours JSONB, escalation_number, recording_enabled BOOL, status CHECK('active','paused','provisioning'), created_at`.
- `hollis_calls` — one row per call: `id, line_id FK, client_id FK, retell_call_id UNIQUE (idempotency key), direction CHECK('inbound','outbound'), caller_number (hashed for GDPR), started_at, ended_at, duration_ms, end_reason, transcript JSONB, summary TEXT, sentiment, outcome CHECK('booked','qualified_lead','message','transfer','no_action'), disclosure_at TIMESTAMPTZ, recording_consent_at TIMESTAMPTZ, recording_url, created_at`.
- `hollis_kb` — per-tenant FAQ/knowledge chunks for grounding: `id, client_id FK, question, answer, embedding, updated_at`.
- RLS on all three (`FOR ALL USING (false)` per repo convention), scoped by `client_id`, matching the existing `client_members`/`clients` pattern.

**`lib/hollis/` module** (mirrors `lib/vera/`, `lib/nora/`):
- `env.ts` — Retell/Cartesia/Deepgram keys.
- `provision.ts` — create Retell agent + buy/assign DID on client onboarding; write `hollis_lines`.
- `config.ts` — load per-tenant `dynamic_variables`, persona, hours from Supabase (cache in Edge Config for <10ms hot reads).
- `tools.ts` — Claude tool schemas (`book_appointment`, `qualify_lead`, `take_message`, `transfer_to_human`, `lookup_faq`) with `strict: true`.
- `webhook.ts` — verify Retell signature, dedup on `retell_call_id`, persist call.
- `normalize.ts` — spoken-form normalization (numbers/dates/currency).
- `notify.ts` — post-call email/Slack/Notion side-effects.
- `*.test.ts` for normalize, tools, webhook dedup.

**Routes:**
- `app/api/hollis/tool/route.ts` — synchronous tool execution (lightweight; module-level Supabase singleton; keep warm). Returns booking/FAQ result string or a stub + fires Inngest for slow side-effects.
- `app/api/hollis/webhook/route.ts` — receives `call_started`/`call_ended`/`call_analyzed`; triggers Inngest on `call_analyzed`.

**Inngest** (`lib/inngest/`): function `hollis/call.analyzed` → step-fn: upsert `hollis_calls` (idempotent) → if booked, create `tickets` row → if lead, CRM webhook → update client dashboard aggregates → `logEvent`. Remember to add the function to the `functions:[]` array in `app/api/inngest/route.ts`.

**Logging:** extend the `logEvent` `Category` union in `lib/logger.ts` to include `"hollis"`, then `logEvent({ clientId, category: "hollis", message, metadata })` at every milestone.

**Admin & per-client Manager:** add a **Hollis** card to the admin dashboard (call volume, outcomes, latency p95, transcripts) + register it in `app/(admin)/agents/agents-manifest.ts`, and a per-client **Manager** under `app/(admin)/clients/[id]/` (line status, persona/hours editor, voice picker, call log, recordings) — same shape as the existing per-client Manager components.

---

## 6. Cost & Unit Economics

### Per-minute (verified mid-2026)

**DIY mid-tier** (Twilio + Deepgram Nova-3 + Claude Haiku 4.5 + OpenAI TTS-1): raw components **~$0.036/min**, realistic all-in **$0.05–0.08/min**. ([verification](https://www.yesworkflow.com/blog/ai-voice-agent-cost))

**Managed (Retell + Claude Haiku + Cartesia):** infra $0.055 + Claude Haiku ~$0.005 + Cartesia TTS ~$0.015 + telephony ~$0.015 = **~$0.09–0.16/min wholesale**. ([Retell pricing](https://www.retellai.com/pricing))

**Vapi BYOK equivalent:** $0.05 platform + components = **$0.12–0.25/min**. ([Vapi pricing](https://vapi.ai/pricing))

> Reality check: **TTS, not LLM, is usually the largest variable cost.** LLM dropped ~80% in a year — Claude Haiku is ~$0.002–0.005/min at real voice token volumes. Don't trust articles quoting 2024 LLM prices.

### Sample monthly bill (wholesale, Retell+Claude+Cartesia ≈ $0.14/min)

| Volume | Wholesale cost | + 1 DID/client overhead |
|---|---|---|
| 1,000 min/mo | ~$140 | + ~$2/number |
| 10,000 min/mo | ~$1,400 | + numbers |

(DIY mid-tier would be ~$50 and ~$500 respectively — a real but, at these volumes, not transformative saving vs the build/ops cost. DIY pencils above ~50K min/mo.) ([cost modeling](https://softcery.com/ai-voice-agents-calculator))

### GB2G resale model (60–75% margin)
- **Starter** $199/mo — 500 min included, $0.35/min overage.
- **Growth** $399/mo — 1,500 min included, $0.30/min overage.
- **Pro** $699/mo — 4,000 min included, $0.25/min overage.
- **Premium Voice add-on** $50–100/mo — unlocks ElevenLabs cloned brand voice.

At Growth: cost ~$120 wholesale + $30 overhead vs $399 revenue → **~62% margin**; overage minutes carry 70–77% margin. Mirror the "replaced receptionist" anchor (~$1,500–3,000/mo) in sales framing. ([reseller pricing](https://trillet.ai/blogs/voice-agent-pricing-strategy-guide)) **Isolate per-tenant minute caps** so one chatty client can't blow a pooled volume rate.

---

## 7. Compliance Checklist (pre-launch, US inbound)

- [ ] **AI disclosure in the first spoken sentence, every call.** *"Hi, this is Hollis, [Business]'s AI assistant."* Satisfies CA SB 243, Utah UAIPA, TX TRAIGA, IL Transparency Act, and is the safe harbor vs deception. ([state laws](https://softcery.com/lab/us-voice-ai-regulations-founders-guide))
- [ ] **Recording consent announcement before recording begins.** *"This call may be recorded."* Covers the **12 all-party-consent states** (CA, CT, DE, FL, IL, MD, MA, MT, NV, NH, PA, WA — note **NV is often wrongly omitted; the count is 12, not 11**). Apply universally. ([recording laws](https://www.recordinglaw.com/party-two-party-consent-states/))
- [ ] **Combined opener:** *"Hollis, [Business]'s AI assistant. This call may be recorded. How can I help?"* — single line covering both.
- [ ] **TCPA: inbound AI answering is NOT covered** (FCC NPRM exempts inbound virtual agents). But **any outbound** AI calling needs prior express (written, for marketing) consent — FCC Feb 2024 ruling makes AI voices "artificial." Gate outbound behind a consent-evidence requirement. ([FCC ruling](https://www.fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal))
- [ ] **California CIPA — highest litigation risk.** The "capability test" (ConverseNow/Domino's, Aug 2025) makes any vendor that retains independent rights to call data a third-party eavesdropper. **Contractually prohibit all vendors (Retell, Deepgram, Cartesia, Anthropic) from using call data for training/their own purposes.** Disclosure alone is not sufficient. ([CIPA case](https://www.wsgrdataadvisor.com/2025/09/u-s-federal-court-allows-cipa-class-action-against-ai-customer-service-provider-to-proceed/))
- [ ] **STIR/SHAKEN:** confirm A-level attestation in writing per number block; verify provider in FCC RMD.
- [ ] **HIPAA tier (if any healthcare tenant):** separate SKU with BAAs across every vendor in the audio chain, TLS 1.3 / AES-256, 6-yr PHI access logs, zero-training clauses. Never route PHI through non-BAA accounts.
- [ ] **PCI (if phone payments):** keep Hollis *outside* the cardholder data environment — DTMF masking at carrier level + dedicated payment IVR branch the AI never touches.
- [ ] **BIPA (Illinois):** if you enable speaker diarization/voiceprints, written consent + public retention policy required; if you don't use voiceprints, BIPA doesn't apply.
- [ ] **Real-time PII redaction middleware** between STT and all storage/logs; category tokens (`[CREDIT_CARD]`), never post-hoc cleanup.
- [ ] **Audit trail per call:** disclosure timestamp, recording-consent timestamp, direction, tenant ID, jurisdiction. Retain ~4 years.
- [ ] **Tenant contracts:** consent reps + indemnification for TCPA/CIPA/BIPA from tenant config; DPAs for their end customers.

---

## 8. Risks, Open Questions & Owner Decisions

**Decide before building:**
1. **Inbound-only v1?** (Strongly recommended — avoids the entire TCPA outbound-consent burden and 4–6 week 10DLC/STIR-SHAKEN lead time.)
2. **Use-case scope per tenant:** appointment booking, lead qualification, FAQ, message-taking, human transfer — which are in v1?
3. **Languages:** English-only v1, or English+Spanish (affects STT model tier).
4. **Healthcare/legal/financial tenants?** If yes → HIPAA SKU + CIPA vendor audit are blocking pre-launch.
5. **Build-vs-buy commitment:** confirm managed-first (Retell) with a documented LiveKit migration trigger (~10K–50K min/mo).
6. **Voice branding:** shared Cartesia voice vs per-tenant cloned voices (upsell).
7. **Budget & target margin** to lock resale tiers.

**Top risks:**
- **Latency disappointment** — Claude Haiku TTFT (~597ms) plus pipeline lands at 700–900ms; relies on masking/design. Mitigate with filler-on-tool-start and pre-cached phrases; benchmark on real calls.
- **CIPA class-action exposure** — the single biggest legal risk; vendor data-rights clauses are the actual control, not the recording disclosure.
- **Vendor lock-in / pricing volatility** — Vapi raised rates ~55% in Dec 2025; store all prompts/flows/config in Supabase, not vendor dashboards, to keep migration cheap.
- **Tool-call timeout** — Vercel cold start can eat the 10s budget; keep the tool route lightweight, warm, Supabase singleton, consider Edge runtime.
- **Per-tenant prompt-injection** via caller speech — isolate/validate tenant system prompts; layered guardrails (prompt + strict tools + post-gen PII scan).
- **Cost runaway on long calls** — cap LLM context (sliding window + state injection) and per-tenant minute caps.

---

## 9. Phased Implementation Roadmap (spec → plan → PR)

**Phase 0 — Spike/POC (1–2 weeks).** Spec: "Hollis answers one hardcoded number, books an appointment, logs a transcript." Stand up Retell + Claude Haiku + Cartesia + one Twilio DID. Single `app/api/hollis/tool` route hitting a stub calendar. Measure real voice-to-voice latency. **Goal: prove <1s and a clean booking.**

**Phase 1 — Single-tenant pilot (2–4 weeks).** Migration `027_hollis.sql` (all three tables). `lib/hollis/` module (config, tools, webhook, normalize). Inngest `hollis/call.analyzed`. Compliance opener + recording consent + PII redaction. Conversation-design pass (fillers, masking, endpointing tuning). Eval harness (Coval or Cekura — Cekura's Claude Code MCP fits the stack) with 600+ scenarios, CI regression gates. **Goal: one real GB2G client live, >90% task success.**

**Phase 2 — Multi-tenant GA (3–6 weeks).** `provision.ts` automates per-client agent + DID + `hollis_lines`. Dynamic-variable injection so one template agent serves N tenants. Per-client Manager portal + admin Hollis dashboard. RLS hardening, vendor no-train clauses, resale tiers + Stripe metering. Premium-voice (ElevenLabs clone) upsell. **Goal: self-serve onboarding, billing, 60%+ margin.**

**Phase 3 — Optimize/scale (ongoing).** A/B TTS via 5% traffic split; per-accent WER tracking; OTel latency SLOs (alert p95 >800ms). Evaluate **LiveKit self-host migration** when sustained volume crosses ~10K–50K min/mo.

Each phase follows GB2G's spec → written plan → reviewed PR workflow, with the spec doc living under `docs/superpowers/specs/` like the existing herald-intake spec.

---

## Appendix: Source List (deduplicated, by topic)

**Platforms (Retell/Vapi/Bland):** retellai.com/pricing · docs.retellai.com/features/webhook-overview · docs.retellai.com/api-references/create-phone-call · vapi.ai/pricing · docs.vapi.ai/server-url/events · docs.vapi.ai/customization/provider-keys · bland.ai/pricing · cloudtalk.io/retell-ai-vs-vapi-ai · famulor.io/blog/retell-ai-vs-vapi-2026

**Self-host / orchestration:** github.com/livekit/agents-js · docs.livekit.io/agents · docs.livekit.io/telephony · livekit.com/pricing · github.com/pipecat-ai/pipecat · forasoft.com/blog/article/livekit-ai-agents-guide · blog.dograh.com/self-hosted-voice-agents-vs-vapi-real-cost-analysis-tco-break-even

**Telephony:** twilio.com/en-us/voice/pricing/us · twilio.com/docs/voice/conversationrelay · twilio.com/en-us/blog/conversationrelay-generally-available · telnyx.com/pricing/voice-api · plivo.com/voice/pricing/us · sipsymposium.com/guides/sip-trunking-for-ai-agents

**STT:** deepgram.com/pricing · deepgram.com/learn/introducing-flux-conversational-speech-recognition · assemblyai.com/pricing · assemblyai.com/benchmarks · assemblyai.com/blog/universal-3-pro-streaming · daily.co/blog/benchmarking-stt-for-voice-agents · soniox.com/blog/soniox-v5-real-time

**TTS:** cartesia.ai/launch · cartesia.ai/pricing · elevenlabs.io/pricing/api · elevenlabs.io/blog/meet-flash · coval.ai/blog/best-text-to-speech-providers-in-2026 · gradium.ai/content/tts-latency-benchmark-2026 · futureagi.com/blog/elevenlabs-vs-cartesia-tts-2026

**LLM / Claude:** platform.claude.com/docs/en/docs/about-claude/models/overview · platform.claude.com/docs/en/build-with-claude/prompt-caching · platform.claude.com/docs/en/agents-and-tools/tool-use/overview · github.com/anthropics/anthropic-sdk-python/issues/1198 · softcery.com/lab/ai-voice-agents-choosing-the-right-llm · kunalganglani.com/blog/llm-api-latency-benchmarks-2026 · twilio.com/en-us/blog/developers/tutorials/product/function-calling-twilio-voice-anthropic-claude-integration

**Native S2S:** openai.com/index/introducing-gpt-realtime · developers.openai.com/api/docs/models/gpt-realtime-2 · callsphere.ai/blog/vw2c-openai-realtime-cost-per-minute-math-2026 · ai.google.dev/gemini-api/docs/live-api · hamming.ai/blog/are-speech-to-speech-models-ready-to-replace-cascade-models

**Latency & turn-taking science:** pmc.ncbi.nlm.nih.gov/articles/PMC2705608 · journalofcognition.org/articles/10.5334/joc.268 · hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it · assemblyai.com/blog/low-latency-voice-ai · cerebrium.ai/blog/deploying-a-global-scale-ai-voice-agent-with-500ms-latency · webrtchacks.com/measuring-the-response-latency-of-openais-webrtc-based-real-time-api

**Conversation design / naturalness:** docs.vapi.ai/prompting-guide · sierra.ai/blog/voice-latency · futureagi.com/blog/voice-ai-barge-in-turn-taking-2026 · hamming.ai/resources/voice-agent-interruption-handling-runbook · livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection · talkdesk.com/blog/voice-design · speechmatics.com/company/articles-and-news/voice-ai-doesnt-need-to-be-faster-it-needs-to-read-the-room

**Eval/monitoring:** coval.ai · hamming.ai/resources/voice-agent-testing-guide · cekura.ai · braintrust.dev/articles/best-voice-agent-evaluation-tools-2025 · futureagi.com/blog/how-to-monitor-ai-voice-agents-production-2026

**Compliance:** fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal · recordinglaw.com/party-two-party-consent-states · wsgrdataadvisor.com/2025/09/u-s-federal-court-allows-cipa-class-action-against-ai-customer-service-provider-to-proceed · leginfo.legislature.ca.gov (AB 2905) · softcery.com/lab/us-voice-ai-regulations-founders-guide · deepgram.com/learn/call-center-compliance-regulations-2026 · hamming.ai/resources/pii-redaction-voice-agents

**Cost / integration / Vercel constraint:** softcery.com/ai-voice-agents-calculator · yesworkflow.com/blog/ai-voice-agent-cost · trillet.ai/blogs/voice-agent-pricing-strategy-guide · vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections · vercel.com/docs/functions/limitations · vercel.com/kb/guide/how-to-build-an-on-demand-voice-agent-with-vercel-sandbox · inngest.com/docs/getting-started/nextjs-quick-start
