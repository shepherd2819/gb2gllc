# ACTION EMAIL — Goosehead vendor readiness: the 3 decisions only I can make

**To:** me (John)
**Re:** Unblocking the Goosehead Insurance vendor deal — what to authorize this week
**Source:** `docs/compliance/2026-06-29-goosehead-vendor-readiness.md` (full package)

---

## The one-paragraph reality

Goosehead corporate's InfoSec team will not sign a third-party vendor for a **voice AI that records calls** without a security attestation, a DPA, proof of insurance, and answers to a security questionnaire. The engineering is largely already in place (encryption, WorkOS RBAC/SSO/audit logs, AI-disclosure greeting, PII redaction). What's missing is the **paper + attestation layer** — and three pieces of that need me to spend money or sign something. Everything else, the build side, GB2G/Claude can produce. **SOC 2 Type II needs a 3–6 month observation window, so the single most time-sensitive action is starting that clock. Every week I wait is a week added to the first enterprise close.**

---

## Decision 1 — Start the SOC 2 clock (THIS WEEK)

- **What:** Sign up for a compliance-automation platform that connects to our stack (Supabase, Vercel, WorkOS, Google, GitHub), continuously collects evidence, and pairs us with an audit firm.
- **Pick:** **Vanta** or **Drata** — roughly a coin-flip for a studio our size. Vanta has the widest auditor familiarity and integration ecosystem; Drata is equally strong and often competitive on price. **Action: get a quote from both this week, pick the cheaper/faster, don't agonize.**
- **Cost (current):** ~**$10k–$40k/yr** platform; **first-year all-in ~$30k–$65k** including the auditor (up to ~$90k if a pen test is bundled).
- **Sequence:** Start now → a **SOC 2 Type I** "bridge" report is reachable ~day 90 (often enough to get through a vendor review while Type II runs) → **Type II** at ~month 6–12.
- **Why me:** It's a funded annual commitment. Nobody else can authorize the spend.

## Decision 2 — Engage a privacy/tech attorney (THIS MONTH)

- **What:** A lawyer to (a) draft our **DPA + subprocessor exhibit**, and (b) review the **call-recording consent / all-party-consent design** for the voice product.
- **Why it's urgent and specific:** Hollis records calls. **California CIPA** (and ~11 other all-party-consent states) is the material litigation risk — recent case law (*Ambriz v. Google*) reads "capability to record" broadly. This is the one item I should not DIY. The attorney also gives us the contract language to **bar Retell / Cartesia / Anthropic from training on our call data** (flow-down terms).
- **Cost:** Variable; a few thousand dollars for the DPA + a scoped recording-consent review. Cheaper than one CIPA demand letter.
- **Why me:** Engaging counsel + the legal judgment call.

## Decision 3 — Bind insurance + fund a pen test (BEFORE SIGNATURE)

- **What:** (a) **Cyber liability + Tech E&O** policy; (b) a **third-party penetration test** of the platform.
- **Limits Goosehead will likely require:** **$1M–$5M** cyber. Pen test ~**$5k–$15k**.
- **Why:** Both are hard contractual gates a large insurance broker puts on vendors. Proof of a bound policy is usually a checkbox in the vendor questionnaire; the pen-test report is requested directly.
- **Why me:** Binding a policy + funding the test.

---

## What I do NOT need to wait on (near-zero cost, start today)

- **Publish a DPA + subprocessor list + a public trust page** — the package has the spec; GB2G can draft, attorney finalizes. Having a trust URL to hand Goosehead signals maturity immediately.
- **Collect each subprocessor's SOC 2 / DPA** (Retell, Cartesia, Anthropic, Supabase, Vercel, WorkOS, Stripe) — pure legwork, no spend.

## What GB2G / Claude will handle (the build side — no authorization needed)

- The **vendor security questionnaire answer bank** (~20 common Qs are pre-drafted in the package).
- The **voice-specific controls** flagged as add-ons: per-state recording policy, deletion-on-request path, enforced transcript-retention purge.
- The **trust-page content** and DPA/subprocessor first drafts for the attorney to finalize.

---

## The single next click

**Today: request Vanta + Drata quotes.** That one action starts the clock that everything else waits on. Decisions 2 and 3 can run in parallel over the next few weeks. The moment Goosehead sends their security questionnaire, reply fast with the answer bank + "SOC 2 in progress (Type I bridge by [date]), DPA available, cyber bound" — that posture is what gets a small vendor through a big broker's review.
