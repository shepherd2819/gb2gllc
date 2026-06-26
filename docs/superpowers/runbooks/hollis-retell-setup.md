# Hollis — Retell Account & Agent Setup (operator runbook)

One-time setup to take Hollis live. Code is already on `main`. Do these in order.
Webhook base = your admin app URL (`NEXT_PUBLIC_ADMIN_URL`, e.g. `https://admin.gb2gllc.com`).

## 1. Create the Retell account
1. Go to https://retellai.com → Sign up. Verify email.
2. Add a payment method (Billing/Settings) — Retell-managed numbers run ~$2/mo + per-minute usage.

## 2. Compliance settings (do this first — it's the real CIPA control)
1. In org/workspace **Settings → Data**: turn **OFF** any "use my data to improve models" / training option (zero-train).
2. Enable **call recording** and **post-call analysis** at the workspace or agent level (we store + redact transcripts).
3. (When you have paying clients) confirm Retell's DPA / no-train terms in writing; same for its sub-processors (Deepgram STT, Cartesia TTS, Anthropic).

## 3. Get the API key
1. **Settings → API Keys** → create a key. Use the key that shows the **webhook badge** (that exact key is what verifies inbound webhook signatures).
2. Set it in Vercel (admin project): `RETELL_API_KEY=...`

## 4. Pick the two voices
1. Open Retell's **Voices** library (or audition Cartesia voices at https://play.cartesia.ai/voices first, then find the match in Retell).
2. Choose one **female** + one **male** conversational voice (recommended: Katie-style female, Jameson-style male).
3. Copy each voice's **Retell voice ID** and set in Vercel:
   - `HOLLIS_VOICE_FEMALE_ID=<retell voice id>`
   - `HOLLIS_VOICE_MALE_ID=<retell voice id>`

## 5. Create the template agent (one agent serves all clients)
1. **Agents → Create → Single-Prompt agent.**
2. **LLM/Model:** `Claude 4.5 Haiku`. Turn OFF extended/adaptive thinking (kills latency). Temperature ~0.3, max ~150 tokens/turn.
3. **Voice:** the female default (it's overridden per-call by our inbound webhook anyway).
4. **System prompt:** paste the starter below. It references dynamic variables we inject per call.
5. **Begin message:** `{{greeting}}` (our inbound webhook supplies the disclosed greeting per call).
6. **Custom functions** — add these 5, each **POST** to `{ADMIN_URL}/api/hollis/tool`:
   | Function | Required params | Optional |
   |---|---|---|
   | `book_appointment` | name, phone, service, preferred_times | email, location, notes |
   | `qualify_lead` | name, phone, intent | email, notes, budget, timeline |
   | `take_message` | name, phone, message | — |
   | `lookup_faq` | query | — |
   | `transfer_to_human` | reason | — |
   - Give each a short **"speak during execution"** filler (e.g. "Let me check that for you…") — this is the latency mask.
   - For **transfer**: easiest is Retell's built-in **Transfer Call** function to the dynamic var `{{escalation_number}}` (warm transfer). Keep `transfer_to_human` too so the brain has a clean intent.
7. **Webhook (agent settings):** set the agent **webhook URL** to `{ADMIN_URL}/api/hollis/webhook` and enable the `call_analyzed` event (also call_started/call_ended is fine). Enable recording.
8. **Save**, copy the **Agent ID** → Vercel: `HOLLIS_RETELL_AGENT_ID=agent_...`

### Starter system prompt
```
You are {{agent_name}}, the AI receptionist for {{business_name}}. You sound like a warm,
efficient human receptionist — natural pacing, the occasional "let me see", never robotic.

You can ONLY help with: {{services}}. Hours: {{hours}}.
Answer questions using this knowledge base; if it's not here, take a message — never invent:
{{faq}}

Rules:
- If the caller wants to book, collect name, phone, the service, and a preferred day/time window
  (plus property address if relevant), then call book_appointment. Do NOT promise a confirmed time —
  say the team will confirm and reach out.
- If they're a new prospect, call qualify_lead.
- For anything you can't handle or if they ask for a person, call transfer_to_human
  (or take_message if no one is available).
- Keep replies short and spoken. Read prices/phones/dates the way a person would say them.
- If asked, you are an AI assistant — say so plainly.
```

## 6. Remaining Vercel env vars
- `HOLLIS_CRM_WEBHOOK_SECRET` (optional — signs outbound CRM webhook deliveries)
- `HOLLIS_RESEND_FROM` (optional — else uses `RESEND_FROM`)
- Already present and reused: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_ADMIN_URL`, `ADMIN_EMAIL`.

## 7. Apply the database migration
```
supabase db push      # applies supabase/migrations/027_hollis.sql (hollis_lines, hollis_calls, hollis_kb)
```

## 8. Provision the pilot number
Two options:
- **From the app (recommended):** open the pilot client's detail page → **Hollis** card → pick a voice → **Provision a number**. This buys a Retell number, binds the template agent, and sets the inbound webhook automatically.
- **From Retell dashboard:** buy a number, bind it to the template agent, and set its **inbound webhook URL** to `{ADMIN_URL}/api/hollis/inbound`. Then insert the line via the app config.

Then configure the line (voice, agent name, hours, services, escalation number, booking email / CRM webhook, FAQ) in the Hollis card and **Save config**.

## 9. Smoke test (verify the two unconfirmed bits)
Call the number and run each flow. Confirm in the app/DB:
- a `hollis_calls` row with the right `outcome`, transcript (PII-redacted), recording URL;
- a booking/lead/message **email** to the business (+ CRM webhook if set);
- a **ticket** created for booking/message/transfer;
- a `client_logs` entry (category `hollis`);
- the call shows in **/agents/hollis**.

**Two things to confirm live (flagged in code):**
1. The exact response field Retell expects from a custom function — our `/api/hollis/tool` returns `{ "result": "<spoken text>" }`. If the agent doesn't speak the result, check Retell's custom-function response format and adjust that one line.
2. Warm **transfer** actually connects to `{{escalation_number}}`.

## 9b. (Optional) Public browser-voice demo — `/hollis-demo.html`

Lets prospects click and talk to Hollis live in the browser (no phone number). Great for sales.
1. In Retell, **duplicate the template agent** → name it "Hollis Demo". Give it a self-explaining prompt (it's talking to prospects, not real callers) and set a short **`max_call_duration_ms`** (e.g. 180000 = 3 min) to cap cost. The page already injects demo dynamic variables (a fictional business "Maple & Co"), so the prompt can just use `{{business_name}}`, `{{services}}`, `{{faq}}`, `{{greeting}}` like the production agent.
2. Copy the demo agent's ID → Vercel: `HOLLIS_DEMO_AGENT_ID=agent_...`
3. `supabase db push` also applies `028_hollis_demo.sql` (the per-IP rate-limit table). The route allows 5 demo calls/IP/day.
4. Share the page: **`https://gb2gllc.com/hollis-demo.html`** (works on the marketing host; the page calls `/api/hollis/demo/web-call` for a token, then connects via the Retell web SDK loaded from esm.sh). Optionally add a "Hear it live" button linking there from the homepage.
5. Test: open the page, click **Tap to talk**, allow the mic, and have a conversation. If Hollis connects but doesn't speak, that's the same custom-function/response check as §9 (only matters once she calls a tool).

## 10. Go-live checks
- Greeting includes the AI disclosure + (if recording) "this call may be recorded".
- Latency feels < ~1s; tune endpointing/filler if not.
- Set a per-line minute cap / monitor `duration_ms` to protect margin.
