# Hollis Marketing Page — "Night Call"

- **Date:** 2026-07-03
- **Status:** Approved for planning (decisions made autonomously per owner's directive "put our Hollis Agent on our website… DOPE looking, like nothing else ever built before"; owner was away during brainstorm — every decision is flagged below for redirect)
- **Author:** Claude, for John (john@gb2gllc.com)

## Summary

A flagship marketing page at **`gb2gllc.com/hollis`** for Hollis, the AI phone receptionist — plus a Hollis product row on the homepage that funnels to it. The page's concept: **the page answers the phone.** It opens as a missed-call moment at night ("9:47 PM. Your phone is ringing."); the visitor taps to answer and is in a **live voice call with Hollis in the browser** (existing Retell web-call demo infrastructure), her speech captioned word-by-word across the hero. Scrolling advances through the night — booking, lead capture, FAQ, message-taking staged as transcript moments — while the page brightens from ink-dark to parchment dawn, ending on the artifact that proves the product: **the email Hollis sent you while you slept.**

## Decisions (made in owner's absence — flag to redirect)

1. **Placement:** dedicated `/hollis` page + homepage product row + `/hollis-demo.html` permanently redirected to `/hollis`. (Chosen over homepage-takeover and demo-page-upgrade.)
2. **Concept:** "Night Call" dark→dawn scroll narrative (Approach A) over a safe product-row-style page (B) and a WebGL visualizer (C).
3. **No public pricing.** Consistent with Herald/Atrium/Steward on the site; protects deal-specific pricing (Goosehead tiers are below rate card).
4. **CTA:** primary = the live call itself (the demo agent already captures name + number for follow-up — the demo IS the lead form); secondary = "Start your setup →" linking to `/intake`, plus `hello@gb2gllc.com`.
5. **Demo agent identity fix:** backend `DEMO_VARS` currently has the agent introduce herself as **"Ava"** while the page brands her **Hollis** — change `agent_name` to "Hollis" and adjust the greeting line (one-file backend edit, in scope).
6. **Homepage copy:** "Three products" becomes "Four products" (hero sub, products eyebrow, meta/OG descriptions).

## Ground truth (verified 2026-07-03)

- Marketing site = static HTML in `public/` with all-inline CSS/JS, served by tiny route handlers (`app/route.ts` reads `public/workbench.html`). **Brand rule: vanilla HTML/CSS/JS, no frameworks, no UI libs.**
- Brand tokens (from `workbench.html` / `hollis-demo.html`): parchment `#F4EEE2`/`#FAF6EC`, ink `#1C1E1B`, dusty-blue `#7F9DB9`/`#4E6E8C`, warm-gold `#C9A961`, sage `#A6B49B`, terracotta `#C97B5C`; Geist / Geist Mono / Instrument Serif. Homepage has precedent for **always-dark sections** (closing/footer) — the night treatment is in-brand.
- Live demo backend exists: `POST /api/hollis/demo/web-call` → Retell `createWebCall` token; **Origin-allow-listed** (gb2gllc.com, www, localhost:3000), 5 calls/IP/day, 150/day global; rows in `hollis_demo_calls` (migration 028, applied). Client: `retell-client-js-sdk@2` from esm.sh; events observed in current demo: `call_started`, `agent_start_talking`, `agent_stop_talking`, `update` (transcript array), `call_ended`, `error`.
- **Prod probe: the route returns 503 "Demo not configured yet."** — `HOLLIS_DEMO_AGENT_ID` and/or Retell secrets are not set in Vercel. The page must be fully self-sufficient in a "line not open yet" state. Runbook: `docs/superpowers/runbooks/hollis-retell-setup.md`.
- Homepage structure: `<section class="products">` with `product-row` blocks (Herald/Atrium/Steward), each pairing `product-info` with a **live/scripted** `product-demo` card ("Three products · all live below"). Herald's card runs a scripted chat loop — the scripted-demo pattern is established.
- Meta Pixel is installed on the homepage (`fbq`).

## The page, scene by scene

Single file `public/hollis.html`, one continuous scroll, five acts. All copy below is draft-final (tighten at build, don't gut).

### Act 1 — The hero: "Answer it." (always-dark)

Full-viewport ink-dark stage. Mono timestamp top-left reading `9:47:12 PM` with seconds ticking (fictional, fixed to the story's night — never the visitor's real clock, so the framing holds at any hour). Center: a **ring halo** — concentric canvas rings that pulse like a ringing phone (subtle audio: none; motion only). Headline in Instrument Serif, huge:

> **Your phone is ringing.**
> **It's 9:47 PM. You're asleep.**
> *Hollis isn't.*

Sub: "Hollis is the AI receptionist GB2G builds for businesses that can't afford a missed call. She answers like a person — books, qualifies, takes messages — every hour you don't."

The halo is a button: **"Answer the phone →"** (aria-label "Start a live voice call with Hollis"). On tap:

- Lazy `import()` of the Retell SDK (not loaded until first tap), token fetch, mic prompt.
- The stage becomes the call: halo switches to **breathing/live** state; Hollis's words stream as **word-by-word serif captions** center-stage (from the `update` transcript event, agent's latest turn); the visitor's own words render small in mono below.
- Status line (mono): `Connecting… / ● LIVE — just talk / Hollis is speaking…`. End-call pill. 
- She introduces herself and will **take your name + number for follow-up** — the hero is the lead form.

**Halo reactivity, layered degradation:** L1 (guaranteed): state animation driven by `agent_start_talking`/`agent_stop_talking`. L2: user-mic amplitude via `AnalyserNode` on the `getUserMedia` stream (we hold mic permission during the call) so the halo reacts when *you* speak. L3 (verify at build): agent-audio amplitude if the SDK exposes raw samples (`emitRawAudioSamples`-style option / `audio` event — confirm against SDK source; if absent, L1+L2 stand). Canvas 2D only; 60fps rAF; fully disabled under `prefers-reduced-motion` (static halo + captions still stream).

**Degraded states (all designed, not error-looking):**
- **503 not-configured:** the halo plays a **scripted sample call** — captions of a real Hollis exchange animate in the same word-by-word style on tap (clearly labeled "sample call — live line opening soon"), and a mono sub-line offers "Want the live line first? hello@gb2gllc.com". The page stays theatrical without the backend.
- **429 rate-limited:** route's friendly message verbatim + the scripted sample.
- **Mic denied / SDK failure:** terracotta hint + scripted sample fallback.

### Act 2 — The night, four calls (dark, brightening)

Scroll-driven vignette sequence — four scenes, each a staged transcript moment with a mono timestamp and one artifact. Background luminosity steps up scene by scene (ink → deep blue-gray → pre-dawn). Implementation: IntersectionObserver adds `in-view` classes; CSS custom-property crossfades; **no scroll-jacking** — natural scroll, generous whitespace.

1. **9:47 PM — She books it.** Caller: "Do you have anything Thursday?" Transcript lines type on; artifact: a **confirmed-appointment card** sliding in (name, service, Thursday 2:30 PM).
2. **11:12 PM — She qualifies the lead.** New-quote caller; Hollis captures name/number/need; artifact: a **lead card** stamped `HOT — new quote`.
3. **2:03 AM — She answers the question.** "Are you open Saturday?" — instant, correct, from *your* knowledge base; artifact: a **KB chip** ("answers only from what you approve — she never makes things up").
4. **6:58 AM — She hands it off.** Caller asks for a human; artifact: **message + warm-transfer note** ("the moment it should be a person, it is").

Each scene footer: one mono stat line (e.g. `answered in <1 ring · 0 voicemails · 0 lost leads`).

### Act 3 — 8:02 AM: the inbox (full parchment)

The dawn payoff. Headline: **"You slept. Here's what you woke up to."** A rendered **email artifact** — the actual product mechanic (email-to-business delivery): "New appointment booked — Thursday 2:30 PM" with the call summary, caller details, transcript link, exactly shaped like Hollis's real delivery email. Sub-line: "Every call becomes a clean, structured email to your team — CRM push optional. No dashboard babysitting."

### Act 4 — Straight answers (parchment)

Tight two-column strip, mono-labeled, honest:
- **Sounds human** — sub-second responses, natural interruptions. "She'll tell you she's an AI — first sentence, every call."
- **Never freelances** — books, qualifies, answers approved FAQs, takes messages. No advice, no quotes, no promises you didn't write.
- **Compliant by default** — AI disclosure + recording notice built in.
- **Runs on** — GB2G + Claude, enterprise voice infrastructure. Managed service: we build her knowledge, tune her voice, watch every call.

### Act 5 — The close (always-dark, mirrors site closing)

> **Put Hollis on your phones.**
> "Tell her yourself — she's listening upstairs." (smooth-scroll link back to hero call) 
> **Start your setup →** (`/intake`) · hello@gb2gllc.com

Legal mono line: "Live AI demo. Calls may be recorded for quality. Demo limited to a few calls per visitor per day."

## Homepage teaser (edit `public/workbench.html`)

A fourth `product-row` (`id="hollis"`, placed FIRST in the products section — flagship): kind tag "AI phone receptionist", copy "The newest member of the fleet answers your phone at 2 AM like it's 2 PM…", CTA "Answer a call from her →" linking `/hollis`. The `product-demo` card follows the homepage's scripted-demo pattern: a mini dark "incoming call" card — pulsing ring, mono caller-ID, looping two-line scripted caption exchange — **no SDK on the homepage** (weight); the card is a doorway, clicking anywhere on it goes to `/hollis`. Copy updates: "Three products" → "Four products" (hero sub line 1311, products eyebrow line 1368, `<meta name="description">`, OG/Twitter descriptions). No other homepage surgery.

## Routing & files

**New**
- `public/hollis.html` — the page (single file, inline CSS/JS, brand tokens copied; scripted-sample call data embedded inline so the degraded mode needs no network).
- `app/hollis/route.ts` — serves `public/hollis.html` (byte-read, `text/html`, same pattern as `app/route.ts`). `/hollis` is NOT in `proxy.ts` matcher → no authkit interference; no proxy change.

**Modified**
- `public/workbench.html` — Hollis product row + copy count updates.
- `app/api/hollis/demo/web-call/route.ts` — `DEMO_VARS.agent_name: "Hollis"`, greeting rewritten to introduce herself as Hollis; add `hollis.html`-appropriate try-phrases. Nothing else.
- `next.config.ts` — permanent redirect `/hollis-demo.html` → `/hollis` (redirects run before the filesystem/public serving; verify at build per `node_modules/next/dist/docs`).

**Deleted**
- `public/hollis-demo.html` (superseded; redirect preserves shared links).

## SEO / analytics / a11y

- Title: `Hollis — the AI receptionist that answers like a person · GB2G`. Meta description + OG/Twitter tags; OG image: reuse the site's `/og` route if it accepts a title param (check at plan time), else static og text tags only.
- Meta Pixel: same snippet as homepage; fire `fbq('trackCustom', 'HollisCallStarted')` on `call_started` and `HollisCallEnded` with duration on end.
- `noindex` NOT set (this is a real marketing page — unlike the intake pages).
- A11y: captions are the accessibility story — every spoken word is on screen; halo button keyboard-operable with visible focus; `aria-live="polite"` caption region; full `prefers-reduced-motion` path (no pulse, no scroll-crossfades, content fully readable statically); color contrast ≥ 4.5:1 for all text on dark.

## Error handling

- Token fetch non-200 → mapped to the designed degraded states (503 scripted-sample / 429 verbatim message / other: "The line hiccuped — try again in a moment").
- SDK `error` event → end call cleanly, reset halo, terracotta hint, offer scripted sample.
- Scripted sample is inline data (no network) — the page can never look broken.
- Serve route: file read failure → 500 plain response (matches root route behavior — no special handling today; keep parity).

## Testing

- Unit-testable pure logic is minimal by design (static page). The one backend edit (`DEMO_VARS`) has existing route behavior covered by manual probe only — verify greeting text lands via curl 503/shape checks (full live check needs Retell env).
- Build check: `npm run typecheck`; serial suite unaffected (no lib/ changes) but run anyway.
- Browser smoke (Playwright): `/hollis` renders; tap → degraded 503 path shows scripted sample (prod parity today); captions animate; reduced-motion media query respected; `/hollis-demo.html` redirects; homepage row renders and links; homepage says "Four products".
- Visual pass on mobile widths (375px) — the halo scales, captions wrap, scenes stack.

## Non-goals (v1)

- No live calendar booking in the demo; no phone-number provisioning flow on the page; no public pricing; no Hollis-specific intake link (generic `/intake` is the funnel; a product-scoped link à la Herald is a fast follow using `intended_product` infra); no self-serve signup; no video production.

## Operator steps (to light the live line)

1. Vercel env: `RETELL_API_KEY`, `HOLLIS_DEMO_AGENT_ID` (duplicate "Hollis Demo" agent with short `max_call_duration`), per runbook `docs/superpowers/runbooks/hollis-retell-setup.md`.
2. Until then the page runs in scripted-sample mode by design — shippable immediately.
