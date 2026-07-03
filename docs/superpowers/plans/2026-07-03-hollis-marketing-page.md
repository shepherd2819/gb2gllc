# Hollis "Night Call" Marketing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** Tasks 1, 2, 4 are mechanical. Task 3 is design-craft — it MUST be executed inline (main loop) by an implementer who first loads the `frontend-design` skill and iterates against real browser screenshots. Fire-and-forget subagents produce templated design; this page's acceptance bar is aesthetic.

**Goal:** Ship `gb2gllc.com/hollis` — a dark-to-dawn cinematic page where visitors answer a live phone call from Hollis — plus a homepage product row funneling to it.

**Architecture:** One static file `public/hollis.html` (all-inline CSS/JS, brand-native) served via a `next.config.ts` rewrite (`/hollis` → `/hollis.html`, same proven pattern as `/about`). Live call via existing `POST /api/hollis/demo/web-call` + `retell-client-js-sdk@2` (lazy-imported from esm.sh on first tap). Scripted-sample fallback embedded inline so the page is fully theatrical while the Retell env is unconfigured (prod 503 today).

**Tech Stack:** vanilla HTML/CSS/JS, Canvas 2D, IntersectionObserver, Retell web SDK (lazy), Meta Pixel. No frameworks, no libraries, no build step.

**Spec:** `docs/superpowers/specs/2026-07-03-hollis-marketing-page-design.md`. Spec amendments discovered at plan time (spec's "ground truth" section wins otherwise):
1. Homepage product rows DO show public pricing (Herald "$500 – $1,500 / month") — the Hollis row shows the rate-card range **$1,500 – $5,000 / month**; the flagship page's Act 5 says "Managed plans from $1,500/month."
2. Serve via `next.config.ts` **rewrite** (not a route handler) — matches `/about`.
3. `/og` route is static (no params) — reuse `https://gb2gllc.com/og` as `og:image` unchanged.
4. SDK verified (`retell-client-js-sdk@2.0.8` d.ts): `startCall({ accessToken, emitRawAudioSamples?: boolean })`; instance exposes `analyzerComponent: { calculateVolume(): number; analyser: AnalyserNode }` — use this for agent-audio halo reactivity (L3 confirmed available).

## Global Constraints

- Vanilla HTML/CSS/JS only for `public/*.html` — no frameworks, no UI libs, no build step. All CSS/JS inline in the file.
- Brand tokens verbatim: parchment `#F4EEE2`/`#FAF6EC`/`#EDE3CC`, ink `#1C1E1B`, ink-soft `#4A4D47`, ink-mute `#8A8C85`, rule `#E4DDCC`, dusty-blue `#7F9DB9`/deep `#4E6E8C`, warm-gold `#C9A961`/deep `#9B7E3F`, sage `#A6B49B`, terracotta `#C97B5C`; fonts Geist / Geist Mono / Instrument Serif (Google Fonts, same `<link>` as existing pages).
- Every dynamic value interpolated into `innerHTML` goes through an `esc()` helper (`&<>"'`).
- `prefers-reduced-motion: reduce` must yield a fully readable, non-animated page (no rAF loop, no pulse, full-line caption fades).
- Do not touch `proxy.ts`. Do not add `/hollis` to its matcher.
- Tests: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'` (serial only). Typecheck: `npm run typecheck`.
- Commits end with trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The Retell SDK is imported ONLY after the visitor taps (dynamic `import("https://esm.sh/retell-client-js-sdk@2")`).

---

### Task 1: Demo agent introduces herself as Hollis

**Files:**
- Modify: `app/api/hollis/demo/web-call/route.ts` (the `DEMO_VARS` object only)

**Interfaces:**
- Consumes: existing route (origin allow-list, limits, `createWebCall`) — unchanged.
- Produces: demo agent identity "Hollis" that Task 3's page copy relies on.

- [ ] **Step 1: Edit `DEMO_VARS`**

Change `agent_name: "Ava"` to `agent_name: "Hollis"`. Replace the `greeting` value with:

```ts
  greeting:
    "Hi! This is Hollis — an AI receptionist built by GB2G, live on their website. " +
    "Ask me anything about GB2G, what I can do, or what I'd sound like answering your business's phone. " +
    "And if you want the team to set up a line for you, just give me your name and number.",
```

In the `faq` string, update the self-identity answer ("Q: Are you a real person?") to:

```
Q: Are you a real person?\nA: Nope — I'm Hollis, an AI receptionist, and a live example of exactly what GB2G builds. Pretty human, right?
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` — clean. Run: `grep -c '"Ava"' app/api/hollis/demo/web-call/route.ts` → `0`.

- [ ] **Step 3: Commit**

```bash
git add app/api/hollis/demo/web-call/route.ts
git commit -m "fix(hollis): demo agent introduces herself as Hollis, not Ava"
```

---

### Task 2: Routing — `/hollis` rewrite, demo-page redirect, delete old page

**Files:**
- Modify: `next.config.ts`
- Delete: `public/hollis-demo.html`

**Interfaces:**
- Consumes: existing `redirects()`/`rewrites()` arrays in `next.config.ts`.
- Produces: `/hollis` serves `public/hollis.html` (Task 3 creates it); `/hollis-demo.html` 308→`/hollis`.

- [ ] **Step 1: Edit `next.config.ts`**

Append to the `redirects()` return array:

```ts
      {
        source: "/hollis-demo.html",
        destination: "/hollis",
        permanent: true,
      },
```

Append to the `rewrites()` return array:

```ts
      { source: "/hollis", destination: "/hollis.html" },
```

- [ ] **Step 2: Delete the superseded page**

```bash
git rm public/hollis-demo.html
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` — clean. (Route behavior is exercised in Task 5 against the dev server; redirects run before the filesystem, rewrites after — `/about` proves the pattern.)

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -m "feat(hollis): /hollis clean URL + permanent redirect from /hollis-demo.html"
```

---

### Task 3: `public/hollis.html` — the Night Call page

**Files:**
- Create: `public/hollis.html`

**Interfaces:**
- Consumes: `POST /api/hollis/demo/web-call` → 200 `{ access_token, call_id }` | 503 `{ error: "Demo not configured yet." }` | 429 `{ error: <friendly message> }` | 502; `retell-client-js-sdk@2` — `new RetellWebClient()`, `startCall({ accessToken, emitRawAudioSamples: true })`, `stopCall()`, events `call_started` / `agent_start_talking` / `agent_stop_talking` / `update` (`u.transcript`: `[{ role: "agent"|"user", content }]`) / `call_ended` / `error`, and `client.analyzerComponent?.calculateVolume(): number`.
- Produces: the page Task 2's rewrite serves and Task 4's homepage row links to.

**Craft directive:** Before writing a line, the implementer loads the `frontend-design` skill. The DOM skeleton, all copy, the JS contracts, and the sample-call data below are binding; visual craft (spacing, easing, halo rendering, scene choreography) is where the taste goes. Iterate with Playwright screenshots at 1440px and 375px until it earns "nothing else like it."

- [ ] **Step 1: Build the page skeleton + copy (binding)**

Head: charset/viewport; `<title>Hollis — the AI receptionist that answers like a person · GB2G</title>`; meta description "Your phone rings at 9:47 PM. Hollis answers — books the appointment, captures the lead, emails you the summary. Talk to her live, right now, in your browser."; favicon `/favicon.svg`; theme-color `#1C1E1B`; OG/Twitter tags (og:url `https://gb2gllc.com/hollis`, og:image `https://gb2gllc.com/og`); Google Fonts link (same families as site); Meta Pixel snippet copied verbatim from `workbench.html` head.

Body structure (IDs binding — JS depends on them):

```html
<nav>              <!-- .word GB2G mark · right: "← gb2gllc.com" link -->
<section id="act-answer" class="act night">      <!-- hero -->
  <div id="clock" class="clock">9:47:12 PM</div> <!-- fictional, seconds tick -->
  <h1>Your phone is ringing.<br>It's 9:47 PM. You're asleep.<br><em>Hollis isn't.</em></h1>
  <p class="lede">Hollis is the AI receptionist GB2G builds for businesses that can't afford a missed call. She answers like a person — books, qualifies, takes messages — every hour you don't.</p>
  <div class="stage">
    <canvas id="halo"></canvas>
    <button id="answer" aria-label="Start a live voice call with Hollis">Answer the phone</button>
    <div id="status" class="status" aria-live="polite">She's on the line.</div>
    <div id="captions" class="captions" aria-live="polite"></div>  <!-- agent serif, visitor mono -->
    <button id="end" hidden>End call</button>
    <div id="hint" class="hint"></div>
  </div>
</section>
<section id="act-night" class="act">   <!-- four scenes, each: -->
  <article class="scene" data-time="9:47 PM">  <!-- transcript lines + artifact card -->
  <article class="scene" data-time="11:12 PM">
  <article class="scene" data-time="2:03 AM">
  <article class="scene" data-time="6:58 AM">
</section>
<section id="act-morning" class="act dawn">  <!-- email artifact -->
<section id="act-answers" class="act day">   <!-- four straight-answer blocks -->
<section id="act-close" class="act night">   <!-- CTA close -->
```

Scene copy (binding; artifact cards as specced):
1. **9:47 PM — She books it.** Caller: "Hi — do you have anything Thursday afternoon?" / Hollis: "We do — I can hold Thursday at 2:30. Can I grab your name and number?" / Caller: "Dana Reyes, 843-555-0114." / Hollis: "Booked. You'll get a text confirming. Anything else tonight?" Artifact: appointment card — `CONFIRMED · Thursday 2:30 PM · Dana Reyes · consult · 843-555-0114`. Stat line: `answered in <1 ring · 0 voicemails`.
2. **11:12 PM — She qualifies the lead.** Caller: "I need a quote for a storefront remodel." / Hollis: "Happy to get you to the right person fast — what's the square footage, and when do you want to start?" / Caller: "About 2,000. Next month." / Hollis: "Got it. Best number for the estimator to call in the morning?" Artifact: lead card stamped `HOT · new quote · 2,000 sq ft · starts next month`. Stat: `every answer captured · nothing lost to voicemail`.
3. **2:03 AM — She answers the question.** Caller: "Are you open Saturday?" / Hollis: "We are — nine to two. Want me to book you in?" Artifact: KB chip — `answers only from what you approve. she never makes things up.` Stat: `your hours · your prices · your policies — never a guess`.
4. **6:58 AM — She hands it off.** Caller: "I really need to talk to someone." / Hollis: "Of course. I'll put you through to Sam right now — and I'll text him what you've told me so you won't repeat yourself." Artifact: message + transfer note — `WARM TRANSFER → Sam · context attached`. Stat: `the moment it should be a person, it is`.

Act 3 (dawn): headline **"You slept. Here's what you woke up to."** Email artifact rendered as a mail card: From `Hollis <hollis@yourbusiness.com>` · Subject `New appointment — Thursday 2:30 PM (Dana Reyes)` · body lines: summary sentence, caller/number/service, `Full transcript attached.` Sub-copy: "Every call becomes a clean, structured email to your team — CRM push optional. No dashboard babysitting."

Act 4 (day) four blocks, mono-labeled: **Sounds human** ("Sub-second responses. Natural interruptions. And she tells every caller she's an AI — first sentence, every call."); **Never freelances** ("Books, qualifies, answers approved FAQs, takes messages. No advice, no quotes, no promises you didn't write."); **Compliant by default** ("AI disclosure and recording notice built in, every call."); **Fully managed** ("GB2G builds her knowledge, tunes her voice, and watches every call. Runs on GB2G + Claude on enterprise voice infrastructure.").

Act 5 (night): **"Put Hollis on your phones."** · link "Tell her yourself — she's listening upstairs ↑" (smooth-scrolls to `#act-answer`) · `Start your setup →` → `/intake` · `hello@gb2gllc.com` · "Managed plans from $1,500/month." · legal mono line: "Live AI demo. Calls may be recorded for quality. Demo limited to a few calls per visitor per day."

- [ ] **Step 2: Implement the JS (contracts binding)**

One inline `<script type="module">`, organized as small functions:

- **State machine:** `idle → connecting → live → ended`, plus `sample` (scripted playback) and `blocked` (mic denied / errors → hint + offer sample). Transitions ONLY via `setState(name)` which toggles classes on `#act-answer`.
- **Call glue:** on `#answer` click from `idle`: `setState("connecting")` → `fetch POST /api/hollis/demo/web-call` → on 200: lazy `const { RetellWebClient } = await import("https://esm.sh/retell-client-js-sdk@2")`, `client.startCall({ accessToken, emitRawAudioSamples: true })`; on 503: `startSample("live line opening soon — this is a sample call")`; on 429: show route's message verbatim then `startSample(...)`; other/network: hint "The line hiccuped — try again in a moment." Events wire exactly as the old demo page did (`call_started`/`agent_start_talking`/`agent_stop_talking`/`update`/`call_ended`/`error`). Fire `window.fbq && fbq("trackCustom","HollisCallStarted")` on `call_started`, `…CallEnded` (with `{seconds}`) on end.
- **Captions:** `renderCaptions(turns)` — show the latest agent turn as large serif text revealed word-by-word (~40ms/word stagger, CSS transition per `<span>`), latest visitor turn small mono beneath; all text through `esc()`. Reduced-motion: reveal whole lines with a simple fade.
- **Halo:** Canvas 2D concentric rings around the button. `getLevel()` per rAF frame: if live and `client.analyzerComponent` → `calculateVolume()`; else if user mic analyser attached and agent not talking → mic RMS; else an attack/decay envelope driven by talking events. States: idle = slow ring pulse (phone ringing); connecting = tightening rings; live = breathing with `getLevel()`; speaking tint warm-gold, listening tint sage; sample = same as live but driven by the script's fake levels. Reduced-motion: static rings, no rAF.
- **Sample call:** inline const `SAMPLE_TURNS` = the Scene-1 booking exchange above as `{ role, content, ms }` turns; `startSample(label)` plays them through the SAME caption renderer with a visible mono label; no network.
- **Scenes:** IntersectionObserver adds `.in` to `.scene`/`.act` (threshold .35) → CSS drives transcript line reveals + artifact slide; page background luminosity via a `--night` custom property stepped per act (ink → `#232833` → `#3a4150` → dawn gradient → parchment). Clock: `setInterval` ticking seconds from 9:47:12 PM (fictional).
- **A11y:** `#answer` and `#end` are real buttons; visible `:focus-visible` rings; captions region `aria-live="polite"`; every animation gated on `matchMedia("(prefers-reduced-motion: reduce)")`.

- [ ] **Step 3: Craft pass (the "dope" gate)**

Load `frontend-design` skill guidance; iterate with screenshots (1440/375, dark scenes and dawn payoff, live + sample states) until the acceptance list below holds. Typography does the heavy lifting: Instrument Serif at clamp(44px→84px) hero, mono timestamps as structural texture, generous negative space, one restrained accent per act.

**Acceptance (Task 5 gates on this list):**
- Hero legible + composed at 1440px and 375px; no horizontal scroll at 375px.
- Tap → (503 today) sample mode plays with visible "sample call" label; captions animate word-by-word; halo alive; End resets to idle.
- All four scenes reveal on scroll; dark→dawn progression unmistakable; email artifact reads as a real email.
- Reduced-motion: zero movement, everything readable.
- Text contrast ≥ 4.5:1 in every act (night acts included).
- Single file; only external requests: Google Fonts, `/og` (meta only), Meta Pixel, and the SDK (only after tap).
- `esc()` wraps every transcript interpolation.

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck` (unchanged, sanity) — clean.

```bash
git add public/hollis.html
git commit -m "feat(hollis): Night Call marketing page — live call hero, dark-to-dawn story"
```

---

### Task 4: Homepage — Hollis product row + fleet copy updates

**Files:**
- Modify: `public/workbench.html`

**Interfaces:**
- Consumes: existing `.products` section markup (rows use `product-row` / `product-info` / `roman` / `name-row` / `kind` / `gloss` / `specs` / `footer-row` / `price` / `product-demo` classes — mirror Herald's row at lines ~1374–1406); Task 3's `/hollis` page.
- Produces: Hollis row first in the products section.

- [ ] **Step 1: Insert the Hollis row**

Directly after `</div>` closing `.products-head` (before the `<!-- I — HERALD -->` comment), insert a new row following the exact Herald markup shape:

```html
  <!-- I — HOLLIS -->
  <div class="product-row" id="hollis-row" data-screen-label="Hollis row">
    <div class="product-info">
      <span class="roman">I.</span>
      <div class="name-row">
        <h3>Hollis</h3>
        <span class="kind">AI phone receptionist</span>
      </div>
      <p class="gloss">She answers at 2 AM like it's 2 PM.</p>
      <p>The newest member of the fleet answers your business's phone in a voice callers swear is a person — books appointments, qualifies leads, answers your FAQs, and takes messages. Then she emails your team a clean summary of every call. Go say hello: she's taking live calls on her page right now.</p>
      <ul class="specs">
        <li>answers in under one ring</li>
        <li>books &amp; qualifies by voice</li>
        <li>emails your team every call</li>
        <li>AI disclosure built in</li>
        <li>warm-transfers to a human</li>
        <li>fully managed by GB2G</li>
      </ul>
      <div class="footer-row">
        <span class="price">$1,500 – $5,000 / month</span>
        <a href="/hollis" class="btn btn-ghost">Answer a call from her <span class="arrow">→</span></a>
      </div>
    </div>

    <!-- demo: incoming call card (doorway — the live call lives on /hollis) -->
    <a class="product-demo" href="/hollis" id="hollis-card" style="text-decoration:none;color:inherit;display:block;">
      <div class="head">
        <div class="title"><strong>incoming call</strong> · 9:47 PM</div>
        <div class="badge"><span class="pulse"></span>Live on /hollis</div>
      </div>
      <div class="body" id="hollis-mini" style="padding:18px 18px 24px;background:#1C1E1B;color:#FAF6EC;min-height:180px;"></div>
    </a>
  </div>
```

- [ ] **Step 2: Mini-card scripted loop**

In the homepage's existing inline script area (near `runHerald2`), add a small loop that renders into `#hollis-mini` (mirroring the scripted-chat idiom): a pulsing ring glyph + caller line `"Do you have anything Thursday?"` then Hollis line `"I can hold 2:30 — what's your name?"`, looping with fades every ~6s; mono caption `tap to answer her live →`. Keep it under ~40 lines; all strings static (no `esc()` needed); guard `document.getElementById("hollis-mini")` existence.

- [ ] **Step 3: Renumber + fleet copy**

- Herald row `roman` `I.` → `II.`; Atrium `II.` → `III.`; Steward `III.` → `IV.`.
- Products eyebrow: `Three products · all live below` → `Four products · all live below`.
- Hero sub (line ~1311): `Three products — website agents, AI website design, and internal AI employees. Watch them run.` → `Four products — an AI receptionist, website agents, AI website design, and internal AI employees. Watch them run.`
- `<meta name="description">`, `og:description`, `twitter:description`: `We build AI employees, intelligent websites, and internal automation…` — replace the sentence `Three products. One team.` with `Four products. One team.`
- Nav live-indicator: `3 agents working` → `4 agents working`.

- [ ] **Step 4: Verify + commit**

Run: `grep -c "Three products" public/workbench.html` → `0`. Run: `grep -c "hollis" public/workbench.html` → ≥ 4.

```bash
git add public/workbench.html
git commit -m "feat(hollis): homepage product row + four-product fleet copy"
```

---

### Task 5: Verification — browser smoke, multi-lens review, polish

**Files:** none created (fixes committed as `fix(hollis): …`).

- [ ] **Step 1: Dev-server browser pass (Playwright)**

`npm run dev`, then verify each; screenshot desktop 1440 + mobile 375:
- `GET /hollis` → 200, page title correct; `GET /hollis-demo.html` → 308 → `/hollis`.
- Homepage: Hollis row first, roman numerals I–IV consistent, "Four products" ×2, mini-card animates, both links → `/hollis`.
- `/hollis`: tap Answer → dev has Retell env? If not: sample mode with label (matches prod 503). End resets. Reduced-motion emulation → no animation. No console errors. No horizontal scroll at 375.
- Check Task 3 acceptance list item by item.

- [ ] **Step 2: Multi-lens review (Workflow)**

Fan out independent reviewers over the committed page + screenshots: (a) visual/typography critic, (b) accessibility auditor (contrast, focus, aria-live, reduced-motion), (c) copy editor (tone: confident, plain, faith-adjacent warmth; no hype-words), (d) code reviewer (XSS/esc coverage, state machine leaks, SDK lazy-load, listener cleanup). Fix everything CONFIRMED; commit fixes.

- [ ] **Step 3: Full checks + wrap**

Run: `npm run typecheck` — clean. Run: `node --import tsx --test --test-concurrency=1 'lib/**/*.test.ts'` — 234/234 (no lib changes expected).
Delete stray screenshots from the repo; `git status` clean.

**Operator (not build):** set `RETELL_API_KEY` + `HOLLIS_DEMO_AGENT_ID` in Vercel (runbook `docs/superpowers/runbooks/hollis-retell-setup.md`) to switch the hero from sample mode to the live line. Page ships either way.

---

## Self-Review (completed by plan author)

1. **Spec coverage:** hero/acts/copy → T3; degraded states → T3 Step 2; homepage row + copy counts → T4; routing/redirect/delete → T2; agent identity → T1; pixel/OG/a11y → T3; verification → T5. Spec amendments (pricing, rewrite-not-route, static OG, SDK analyzer) recorded in header.
2. **Placeholder scan:** none; Task 3 deliberately grants CSS-craft freedom within binding skeleton/copy/contracts — flagged as design-craft deviation in the header note, with a checkable acceptance list.
3. **Type consistency:** IDs (`#answer`, `#end`, `#status`, `#captions`, `#halo`, `#clock`, `#hollis-mini`) and event names match across T3 steps and T5 checks; route contract matches `app/api/hollis/demo/web-call/route.ts` exactly.
