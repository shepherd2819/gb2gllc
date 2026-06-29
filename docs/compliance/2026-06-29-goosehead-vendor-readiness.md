# Goosehead Vendor Security & Certification Readiness Package — "Hollis" Inbound Voice Agent

**Prepared for:** GB2G LLC (John) — pursuing third-party vendor approval at Goosehead Insurance (NASDAQ: GSHD), a publicly traded US personal-lines insurance brokerage.
**Product in scope:** **Hollis** — inbound-only AI phone receptionist (books appointments, qualifies leads, answers FAQs, takes messages, warm-transfers). English-only. General-SMB tier (no HIPAA/PCI tier today).
**Date:** 2026-06-29
**Status of this doc:** Internal strategy + answer bank. Not a customer-facing artifact. Most of what follows is achievable by the dev team; the items marked **[JOHN-ONLY]** require money or legal sign-off.

> **One-line honest reality:** Certifications like SOC 2 Type II are *external audits of a time window you have not started yet*. You cannot "get certified this month." What you **can** do in 30–90 days is build a credible, well-documented security program, lean on the strong compliance posture of your subprocessors, sign a real DPA + cyber policy, and pass Goosehead's questionnaire as an honest, well-architected small studio with a SOC 2 **in progress**. That combination wins pilots; the SOC 2 Type II report (real time + money) closes the enterprise-grade contract 6–12 months out.

---

## 1. Executive Summary — the honest reality

**What a cert actually is.** SOC 2 and ISO 27001 are not things you buy and switch on. SOC 2 is a **CPA firm's attestation** about whether your controls were designed (Type I, a point in time) and *operated effectively over a period* (Type II, typically a 3–6 month observation window). ISO 27001 is an **accredited certification body's pass/fail audit** of a full Information Security Management System (ISMS). ([SOC 2 vs ISO 27001 — Secureframe](https://secureframe.com/blog/soc-2-vs-iso-27001), [Vanta — SOC 2 audit cost](https://www.vanta.com/collection/soc-2/soc-2-audit-cost))

**For a US insurance brokerage, SOC 2 is the currency, not ISO 27001.** US enterprise procurement runs on SOC 2; ISO 27001 is what EU/UK/APAC buyers ask for and is rarely accepted as a US substitute. Build toward SOC 2 first. ([SOC 2 vs ISO 27001 2026 — soc2auditors.org](https://soc2auditors.org/insights/soc-2-vs-iso-27001/))

**The timeline truth:**

| Horizon | What is realistically achievable |
|---|---|
| **30 days** | Documented security program (policies), DPA published, cyber-liability quote in hand, subprocessor list + their SOC 2 reports collected, voice-compliance controls hardened, questionnaire answer bank ready, public trust page live. **A SOC 2 readiness clock started in Vanta/Drata.** |
| **60 days** | Vanta/Drata fully connected (evidence auto-collecting), MFA/SSO/encryption/logging controls proven, pen test scheduled, **SOC 2 Type I** achievable if pushed. |
| **90 days** | **SOC 2 Type I report in hand** (point-in-time) — use as a bridge. Pen test completed + remediated. Cyber policy bound. |
| **6 months** | **SOC 2 Type II observation window CLOSES** (if the clock started at day 0–30). Auditor fieldwork begins. |
| **6–12 months** | **SOC 2 Type II report delivered.** This is the artifact that unlocks "enterprise-grade vendor" status at a brokerage. |

The shortest honest path to a *signed* Goosehead contract: pass the questionnaire now on the strength of your architecture + subprocessors + DPA + cyber insurance + a SOC 2 **in progress**, optionally deliver a **Type I bridge** at ~90 days, and commit contractually to delivering **Type II within ~12 months**. Many security teams accept a Type I as interim evidence from a young vendor but expect Type II to follow within the year. ([SOC 2 bridge/Type I — Secureframe](https://secureframe.com/hub/soc-2/bridge-letter), [Workstreet — Type 1 vs Type 2](https://www.workstreet.com/blog/soc-2-type-1-vs-type-2))

---

## 2. What Goosehead Will Almost Certainly Ask For — prioritized checklist

Ordered by how likely it is to be a hard gate (P0 = deal-blocker if missing).

| # | Item | Priority | Why a brokerage cares |
|---|---|---|---|
| 1 | **SOC 2 Type II report** (or Type II *in progress* with a credible date, + Type I bridge) | **P0** | The de-facto US enterprise security baseline; their InfoSec team's default ask. |
| 2 | **Signed DPA** (data processing agreement) with subprocessor list + breach-notification SLAs | **P0** | GLBA + NAIC Model Law require them to contractually bind service providers handling nonpublic personal info (NPI). |
| 3 | **Cyber liability / Tech E&O insurance** — typically **$1M–$5M** limits, customer named as additional insured | **P0** | Risk transfer; standard contractual requirement for any data-handling SaaS vendor. |
| 4 | **Completed security questionnaire** (SIG-Lite, CAIQ, or their custom/VSA) | **P0** | How their TPRM (third-party risk mgmt) team scores you. |
| 5 | **Penetration test report** (recent, third-party, with remediation evidence) | **P1** | Validates the app isn't trivially breakable; often a SOC 2 input too. |
| 6 | **Subprocessor SOC 2 reports** (Retell, Anthropic, Cartesia, Supabase, Vercel, etc.) | **P1** | They push diligence down your supply chain. |
| 7 | **"No training on our call data" contractual commitment** across the whole AI stack | **P1** | Voice-AI-specific; the CIPA "capability" risk makes this material. |
| 8 | **Written InfoSec program / policies** (access control, IR, BCP/DR, change mgmt, vendor mgmt, data retention) | **P1** | Required even without a cert; SOC 2 readiness produces these. |
| 9 | **Call-recording consent + AI-disclosure design** evidence | **P1** | Insurance + CIPA exposure; they don't want to inherit your wiretap risk. |
| 10 | **Data-flow / architecture diagram** + data-retention & deletion policy | **P2** | Standard questionnaire attachment. |
| 11 | **Evidence of MFA/SSO, encryption at rest + in transit, RBAC, audit logging** | **P2** | Maps to NY DFS 500 / NAIC technical safeguards they may flow down. |
| 12 | **Incident response + breach notification process** (with a contact + timeline) | **P2** | NAIC Model Law requires breach notice to the regulator within 72 hours; they'll want notice from you faster. |
| 13 | **Public trust center / security page** | **P3** | Speeds diligence; signals maturity. |

---

## 3. Gap Assessment — GB2G's current posture vs each requirement

Legend: **Have** / **Partial** / **Missing**

| Requirement | Status | Notes |
|---|---|---|
| SOC 2 Type II | **Missing** | Not started. No Vanta/Drata clock running. This is the single biggest gap. |
| SOC 2 Type I (bridge) | **Missing** | Achievable ~90 days after starting readiness. |
| DPA published | **Missing** | None drafted. Needed before any data-handling contract. **[JOHN-ONLY — legal]** |
| Cyber liability / Tech E&O insurance | **Missing** | None bound. Quote obtainable in days. **[JOHN-ONLY — money]** |
| Written InfoSec program / policies | **Missing** | No formal documented program. Vanta/Drata templates + a focused week fixes most of this. |
| Security questionnaire answer bank | **Partial → Have (this doc)** | §7 below is a starter bank. |
| Penetration test | **Missing** | Need a third-party vendor. ~$5K–$15K. **[JOHN-ONLY — money]** |
| Subprocessor SOC 2 collection | **Partial** | Most subprocessors are strong (see §5); reports need to be pulled under NDA. |
| "No training on call data" across stack | **Partial** | Anthropic API (commercial terms) + Cartesia ZDR + Retell controls support this; needs to be locked in writing per vendor. |
| MFA/SSO | **Have (capability)** | WorkOS provides SSO/SCIM; enforce + document MFA on all admin accounts. |
| Encryption at rest + in transit | **Have** | Supabase (at rest) + TLS everywhere; Retell encrypts call data in transit/at rest. |
| RBAC | **Have** | Phase B RBAC session helpers + tier-driven seat caps already shipped (recent commits). |
| Audit logging | **Have** | WorkOS Audit Logs mirroring already implemented (Phase B5); `logEvent` with category union. |
| AI disclosure in greeting | **Have (design)** | Hollis `greeting` lib emits AI + "may be recorded" disclosure in first sentence. |
| PII redaction on transcripts | **Have (design)** | Hollis `redact` lib exists; confirm scope (SSN/card/DOB patterns) + apply pre-storage. |
| Configurable data retention | **Partial** | Retell supports per-agent retention (1 day–2 yr); GB2G needs a *stated policy* + enforcement in `hollis_calls`. |
| Data-flow / architecture diagram | **Missing** | Quick to produce from the existing spec. |
| Incident response / breach plan | **Missing** | Template-driven; produce during readiness. |
| Public trust page | **Missing** | See §8. |
| BCP / DR plan | **Missing** | Largely inherited from Vercel/Supabase/Retell; document RTO/RPO + your part. |

**Net:** Your *technical* controls are in surprisingly good shape (encryption, RBAC, audit logs, SSO/SCIM, redaction, disclosure all exist). Your *paper + external-attestation* layer is the gap: no SOC 2, no DPA, no cyber policy, no pen test, no written program.

---

## 4. Roadmap — 30 / 60 / 90-day + 6-month

Marked **[EXT]** = needs an external party (vendor/auditor/attorney/broker). **[DEV]** = GB2G/dev team can produce. **[JOHN]** = money or legal authorization.

### 30 days
- **[JOHN][EXT]** Pick and start **Vanta or Drata**; connect Supabase/Vercel/WorkOS/GitHub integrations so evidence auto-collects. *Starting the clock is the highest-leverage single action.*
- **[JOHN][EXT]** Engage a **privacy/tech attorney** to draft a **DPA + subprocessor exhibit** and review call-recording consent language.
- **[JOHN][EXT]** Get **cyber liability + Tech E&O** quotes ($1M–$5M); plan to bind before contract signature.
- **[DEV]** Generate policy set from Vanta/Drata templates (access control, IR, BCP/DR, change mgmt, vendor mgmt, data retention, acceptable use, encryption). John approves/owns them.
- **[DEV]** Collect subprocessor SOC 2 / DPA / no-training terms (§5) into a binder.
- **[DEV]** Harden voice controls (§6): lock disclosure script, confirm redaction patterns, set + enforce retention default.
- **[DEV]** Publish a v1 **trust page** (§8) and the **answer bank** (§7).

### 60 days
- **[DEV]** Prove technical controls in the GRC platform: MFA enforced everywhere, encryption documented, logging/monitoring, onboarding/offboarding, vuln management.
- **[JOHN][EXT]** Schedule the **third-party penetration test** of the web app + webhook surface.
- **[DEV]** Produce data-flow diagram + asset inventory (also a NY DFS 500 / NAIC ask).
- **[EXT]** Auditor selection conversation (often bundled by Drata/Vanta).

### 90 days
- **[EXT]** **SOC 2 Type I** report issued (point-in-time) — your bridge artifact.
- **[EXT]** **Pen test** completed; **[DEV]** remediate findings + document.
- **[JOHN]** **Bind cyber policy.**
- **[DEV]** Respond to Goosehead's questionnaire with the bank + Type I + DPA + insurance certificate (COI).

### 6 months
- **[EXT]** **SOC 2 Type II observation window closes** (assuming clock started ~day 0–30 with a 6-month window).
- **[EXT]** Auditor fieldwork → **Type II report ~month 6–9**, refreshed annually with bridge letters (≤3 months) between report date and a buyer's review. ([Linford — bridge letters](https://linfordco.com/blog/gap-bridge-letter/))

**Realistic first-year cash outlay (current figures):**
- GRC platform (Vanta $10K–$30K/yr; Drata $7.5K–$100K+, often bundled with auditor at ~$30K–$40K). ([Vanta pricing](https://soc2auditors.org/insights/vanta-pricing/), [Drata cost](https://drata.com/grc-central/soc-2/how-much-does-a-soc-2-audit-cost))
- SOC 2 Type II auditor (small/midsize): ~**$12K–$20K** typical, up to $15K–$50K. ([Vanta — audit cost](https://www.vanta.com/collection/soc-2/soc-2-audit-cost))
- Pen test: ~$5K–$15K (often a "hidden" SOC 2 cost).
- **All-in first-year SOC 2 Type II: commonly $30K–$65K, up to ~$60K–$90K** with pen test included. ([Sprinto — SOC 2 cost 2026](https://sprinto.com/blog/soc-2-compliance-cost/), [The Sector Post — SOC 2 audit costs 2026](https://www.thesectorpost.com/compliance/soc2/audit-costs))
- DPA/attorney: a few thousand to low five figures.
- Cyber liability premium: small-vendor policies for a $1M–$2M limit are typically low-to-mid four figures/yr depending on revenue + controls.

---

## 5. Subprocessor & DPA Strategy

The strength of your subprocessor stack is a genuine asset — most are already SOC 2 Type II. Your job is to (a) collect their reports, (b) get DPAs in place, and (c) lock "no training on call data" in writing, then flow that down to Goosehead.

| Subprocessor | Role / data touched | What to verify | Posture (per current public info) |
|---|---|---|---|
| **Retell AI** | Realtime telephony loop, STT/TTS orchestration, Twilio number mgmt, recordings/transcripts | SOC 2 Type II report; HIPAA BAA availability; per-agent retention config; PII redaction; **no-training term** | **Strong** — states SOC 2 Type I + II, HIPAA-compliant with self-serve BAA, RBAC, automatic PII redaction, configurable retention (1 day–2 yr), encryption in transit + at rest. ([Retell compliance](https://docs.retellai.com/general/compliance)) |
| **Anthropic (Claude Haiku)** | Reasoning brain; receives call text turns | Commercial Terms (no training on inputs/outputs); **Zero Data Retention** eligibility for your API org; SOC 2/ISO reports | **Strong** — commercial/API terms prohibit training on customer data; ZDR available for commercial API keys; SOC 2 Type II + ISO 27001:2022 + ISO 42001:2023. ([Anthropic API data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [ZDR](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)) |
| **Cartesia** | TTS voice synthesis | SOC 2 Type II; optional ZDR; no-training term; GDPR | **Strong** — SOC 2 Type II, PCI-DSS (SLP), HIPAA, optional Zero Data Retention, GDPR-compliant. ([Cartesia GDPR](https://cartesia.ai/blog/gdpr-compliance)) |
| **Supabase** | Postgres — call records, KB, client data (NPI lives here) | SOC 2 Type II; encryption at rest; DPA; region; RLS in use | Strong — SOC 2 Type II, HIPAA add-on; ensure RLS + at-rest encryption documented. |
| **Vercel** | Web app + webhook hosting (no realtime loop) | SOC 2 Type II; DPA | Strong — SOC 2 Type II; confirm no NPI persisted at edge. |
| **WorkOS** | Auth/SSO/SCIM/Audit Logs | SOC 2 Type II; DPA | Strong — SOC 2 Type II; already integrated for SSO/SCIM/audit. |
| **Stripe** | Billing (no call data) | PCI-DSS Level 1; SOC 2 | Strong; out of NPI/call-data scope. |
| **Resend** | Transactional email (booking/message delivery — may contain caller name/phone/intent) | SOC 2; DPA; retention | Verify; note email can carry NPI → include in DPA subprocessor list. |
| **Inngest** | Background jobs (post-call processing) | SOC 2; DPA; data minimization | Verify; ensure payloads minimized/redacted. |
| **Google / Gmail & Calendar** | Optional booking/email integration | Google Workspace DPA; scopes | Verify least-privilege scopes; document. |
| **Notion** | Internal docs (should NOT hold caller NPI) | Keep call data OUT of Notion | Policy: no caller PII in Notion. |
| **Twilio** (via Retell) | Phone numbers / carrier | Covered under Retell; confirm sub-subprocessor disclosure | Inherited via Retell. |

**Flow-down language to obtain from Retell / Cartesia / Anthropic (and to mirror in your DPA to Goosehead):**

> *"Vendor and its subprocessors shall not use Customer Data — including call audio, recordings, transcripts, or derived data — to train, fine-tune, or improve any model or product, and shall process such data solely to provide the contracted service. Customer Data shall be encrypted in transit and at rest, retained only for the period specified in the Order/DPA, and deleted on termination or request. Vendor shall notify Customer of any security incident affecting Customer Data without undue delay and no later than [48–72] hours."*

**DPA must include:** scope of processing, subprocessor list (the table above) + change-notice, security measures, sub-processing restrictions, **no-training clause**, retention + deletion, breach notification SLA, audit rights, and a GLBA/NPI handling acknowledgment.

---

## 6. Voice-Specific Compliance Controls

Voice AI is the part of this deal with *novel, active litigation risk* — treat it as first-class.

**The legal backdrop (real + current):**
- **CIPA "capability" doctrine.** In *Ambriz v. Google* (N.D. Cal., Feb 2025) the court let a CIPA wiretap claim proceed against an AI voice/contact-center product based on its *capability* to use intercepted call data — **even where the privacy policy said data wasn't used for training.** Capability, not actual use, is the test. Multiple copycat suits followed (*Galanter v. Cresta*, *ConverseNow/Domino's*). California CIPA is your single biggest litigation exposure. ([Goodwin — AI voice + CIPA](https://www.goodwinlaw.com/en/insights/publications/2025/02/alerts-practices-dpc-ftec-ai-voice-products-subject-to-california-invasion-of-privacy-claims), [Wilson Sonsini — CIPA class action proceeds](https://www.wsgr.com/en/insights/us-federal-court-allows-cipa-class-action-against-ai-customer-service-provider-to-proceed.html))
- **All-party / two-party consent states (~12):** California, Delaware, Florida, Illinois, Maryland, Massachusetts, Montana, Nevada, New Hampshire, Pennsylvania, Washington (+ others by interpretation). Get consent from all parties before recording. ([Recording Law / The Lyon Firm summary](https://thelyonfirm.com/blog/ai-call-monitoring-lawsuits-tcpa/))
- **AI bot disclosure laws.** California **SB 1001** bars using a bot to deceive about its non-human identity in a commercial transaction; disclosure must be "clear, conspicuous." **Utah's AI Policy Act** (eff. May 2025) requires "you're talking to AI" disclosure on request in consumer transactions (and proactively for some categories). ([CA SB 1001 — Akin](https://www.akingump.com/en/insights/blogs/ag-data-dive/california-s-new-bot-law-prohibits-use-of-undeclared-bots), [Utah AI Act — Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/utahs-ai-policy-act-now-effective))
- **TCPA boundary.** Inbound calls (caller dials you) are **not** TCPA-covered. Any future **outbound** dialing/voice would trigger TCPA + FCC AI-voice rules — out of scope for Hollis v1, but document the boundary so it doesn't drift.
- **HIPAA/PHI.** A general insurance-brokerage receptionist taking lead/appointment info is **not** handling PHI, so no BAA is required *for that use*. But health/Medicare-supplement lines, or a caller volunteering medical details, can pull PHI in. Mitigate with redaction + a "do not solicit health info" prompt guardrail; keep HIPAA out of scope contractually unless/until you build a HIPAA tier (Retell + Cartesia + Anthropic all *can* support BAAs if you later need one).

**Required behaviors — already-in-design vs. add:**

| Control | Requirement | Status in Hollis | Action |
|---|---|---|---|
| **AI disclosure** | State it's an AI/automated assistant in the first sentence, clearly. | **Have (design)** — `greeting` lib emits it. | Confirm wording is unambiguous ("an automated/AI assistant"); answer-on-request handling. |
| **Recording notice** | "This call may be recorded" up front; obtain all-party consent for recording in 2-party states. | **Have (design)** — greeting includes "may be recorded." | **Strengthen:** in all-party-consent states, prefer *affirmative* consent or no-recording mode; give callers an opt-out path. **[JOHN/legal review]** |
| **No-training lock** | Contractually bar Retell/Cartesia/Anthropic/(Deepgram) from training on call data. | **Partial** | Lock per §5 flow-down + enable Anthropic ZDR + Cartesia ZDR. |
| **Transcript PII redaction** | Redact SSN/DOB/card/financial account numbers before storage. | **Have (design)** — `redact` lib. | Verify pattern coverage; apply pre-persist in `hollis_calls`; redact in Inngest payloads + emails. |
| **Retention limits** | Stated, enforced minimum-necessary retention for recordings/transcripts. | **Partial** | Set a default (e.g., transcripts 90 days, recordings 30 days or off by default), enforce via Retell per-agent config + a purge job; publish the policy. |
| **Deletion on request** | Honor caller/client deletion requests. | **Missing** | Add a delete path for `hollis_calls` + Retell-side. |
| **Consent state map** | Per-line behavior by state for recording. | **Missing** | Add a state→recording-policy config on `hollis_lines`. **[JOHN/legal review]** |

---

## 7. Vendor Questionnaire Answer Bank (starter — ~18 Q&A)

Draft answers calibrated to an honest, well-architected small studio. Replace bracketed placeholders before sending. Where the truthful answer is "not yet," say so + state the date — InfoSec teams respect candor over inflated claims.

1. **Do you have a SOC 2 Type II report?**
   *Not yet. We are in active SOC 2 Type II readiness via [Vanta/Drata], started [DATE]. A Type I report is targeted for [~90 days out] and Type II for [~month 9–12]. Our subprocessors (Anthropic, Retell, Cartesia, Supabase, Vercel, WorkOS) are SOC 2 Type II; reports available under NDA.*

2. **Is customer/call data used to train AI models?**
   *No. We contractually prohibit all AI subprocessors from training on customer data. Anthropic (commercial API terms + Zero Data Retention) and Cartesia (Zero Data Retention) do not train on our inputs/outputs; Retell is configured for no-training and PII redaction.*

3. **Is data encrypted in transit and at rest?**
   *Yes. TLS 1.2+ in transit across all services; at-rest encryption (AES-256) via Supabase (Postgres) and our subprocessors. Call media is encrypted in transit and at rest by Retell.*

4. **How is access controlled? Do you enforce MFA/SSO?**
   *Role-based access control (RBAC) with least privilege; SSO + SCIM via WorkOS; MFA enforced on all administrative accounts and cloud consoles. Access is provisioned/deprovisioned through onboarding/offboarding procedures.*

5. **Do you maintain audit logs?**
   *Yes. Application and admin actions are logged and mirrored to WorkOS Audit Logs (org-scoped). Infrastructure logs are retained via our platform providers.*

6. **Where is data hosted? What regions?**
   *Web/app on Vercel (US); primary data store Supabase Postgres (US region [confirm]); realtime voice loop hosted by Retell (US). No customer data is stored outside the US.*

7. **List your subprocessors.**
   *Retell AI (telephony/STT/TTS), Anthropic (LLM), Cartesia (TTS), Supabase (database), Vercel (hosting), WorkOS (auth/SSO/audit), Stripe (billing), Resend (email), Inngest (jobs), Google Workspace (optional calendar/email). Full list + roles maintained in our DPA; customers are notified of material changes.*

8. **Do you have cyber liability / Tech E&O insurance?**
   *Yes — [Cyber + Tech E&O], limits [$X M per claim / $X M aggregate], carrier [NAME]. We can name [Goosehead] as additional insured and provide a COI.* *(Bind before answering "yes.")*

9. **Have you had a penetration test? When?**
   *Yes — independent third-party penetration test by [vendor] completed [DATE]; findings remediated. Summary/attestation available under NDA. Conducted at least annually.*

10. **Describe your incident response and breach notification process.**
    *Documented IR plan with defined roles, severity tiers, and containment/eradication/recovery steps. We notify affected customers of any incident involving their data without undue delay and within [48–72] hours, with regulator notification timelines honored per applicable law.*

11. **What is your data retention and deletion policy?**
    *Minimum-necessary retention: call transcripts [90] days, recordings [30] days (or disabled by default), configurable per client. Data is deleted on termination or verified request. Recording retention is enforced via per-line configuration and a scheduled purge job.*

12. **How do you handle PII in call transcripts?**
    *Automated redaction of sensitive identifiers (e.g., SSN, payment card, financial account, DOB) before persistence. Transcripts are access-controlled and retention-limited. We instruct the agent not to solicit sensitive personal or health information.*

13. **Do you handle PHI? Are you HIPAA compliant / will you sign a BAA?**
    *Hollis is a general-business receptionist and is not intended to process PHI; we do not require a BAA for this use. Our voice subprocessors can support BAAs if a HIPAA-scoped engagement is later required.*

14. **How do you comply with call-recording consent laws?**
    *Callers receive an up-front recording notice and AI-assistant disclosure at the start of each call. We support per-state recording policies for all-party-consent jurisdictions and provide an opt-out. Inbound-only (no outbound dialing), so TCPA outbound rules do not apply.*

15. **Do you have documented information security policies?**
    *Yes — a documented InfoSec program including access control, acceptable use, change management, vendor/third-party risk, business continuity/DR, data retention, encryption, and incident response policies, reviewed at least annually.*

16. **What is your business continuity / disaster recovery posture?**
    *Core infrastructure (Vercel, Supabase, Retell) provides managed redundancy and backups. We maintain a documented BCP/DR plan; database point-in-time recovery via Supabase; target RTO [X] / RPO [X]. Stateless app tier redeploys rapidly.*

17. **How do you manage vulnerabilities and patching?**
    *Dependency scanning and automated updates in CI; managed platform patching for infra; vulnerabilities triaged by severity with defined remediation SLAs; annual penetration testing.*

18. **Do employees receive security awareness training and background checks?**
    *Yes — security awareness training on hire and annually; background checks for personnel with production/data access. (We are a small team; access is tightly scoped and individually accountable.)*

19. **Can we audit you / review your controls?**
    *We provide SOC 2 reports (when available), our DPA, security policies, pen-test attestation, and questionnaire responses under NDA, and respond to reasonable annual reassessments. On-site/remote audit available by arrangement.*

20. **How is data segregated between tenants (multi-tenancy)?**
    *Logical isolation per client via row-level security and per-client configuration/keys; per-client phone lines and call records scoped by tenant. No commingling of one client's call data with another's.*

---

## 8. Trust Center

**What it is:** a public web page that pre-answers the easy 60% of diligence so InfoSec only has to ask about the rest. It shortens sales cycles and signals maturity.

**Where it should live:** `gb2gllc.com/trust` (or `/security`), linked from the footer and from the Hollis product page. Build it as a simple Vercel route in the existing app.

**What it should contain:**
- **Security overview** — encryption (in transit + at rest), SSO/MFA, RBAC, audit logging, hosting (US).
- **Compliance status** — honest: "SOC 2 Type II in progress (Type I [date]); subprocessors are SOC 2 Type II." Link to a request-under-NDA flow for reports.
- **Subprocessor list** — the §5 table (public version) with roles + a way to subscribe to change notices.
- **Data handling & retention** — what's collected on calls, redaction, retention windows, deletion-on-request.
- **AI & voice transparency** — AI-assistant disclosure, recording-consent practice, **"we never train on your call data."**
- **Privacy & legal** — links to Privacy Policy, DPA (downloadable), Terms.
- **Responsible disclosure** — a `security@gb2gllc.com` contact + reporting process.
- **Insurance** — statement that cyber/Tech E&O coverage is maintained (COI on request).

Keep it factual and current — a trust page that over-claims is worse than none, because InfoSec teams verify it.

---

## Sources

- SOC 2 vs ISO 27001 (US enterprise default = SOC 2): [Secureframe](https://secureframe.com/blog/soc-2-vs-iso-27001), [soc2auditors.org 2026](https://soc2auditors.org/insights/soc-2-vs-iso-27001/)
- SOC 2 cost/timeline 2026: [Vanta](https://www.vanta.com/collection/soc-2/soc-2-audit-cost), [Sprinto](https://sprinto.com/blog/soc-2-compliance-cost/), [The Sector Post](https://www.thesectorpost.com/compliance/soc2/audit-costs), [Drata](https://drata.com/grc-central/soc-2/how-much-does-a-soc-2-audit-cost), [Vanta pricing](https://soc2auditors.org/insights/vanta-pricing/)
- SOC 2 Type I bridge / observation window: [Secureframe](https://secureframe.com/hub/soc-2/bridge-letter), [Workstreet](https://www.workstreet.com/blog/soc-2-type-1-vs-type-2), [Linford](https://linfordco.com/blog/gap-bridge-letter/)
- Vendor questionnaires (SIG/CAIQ/VSA): [Bitsight](https://www.bitsight.com/blog/caiq-vs-sig-top-questionnaires-vendor-risk-assessment), [Workstreet](https://www.workstreet.com/blog/caiq-vs-sig), [GetAgency](https://blog.getagency.com/articles/security-questionnaires-caiq-sig-vsa)
- NAIC Insurance Data Security Model Law: [NAIC brief (Aug 2025)](https://content.naic.org/sites/default/files/government-affairs-brief-data-security-model-law.pdf), [Akin — adoptions](https://www.akingump.com/en/insights/blogs/ag-data-dive/two-more-states-adopt-naic-model-data-security-law)
- NY DFS 23 NYCRR 500 third-party: [Greenberg Traurig (Nov 2025)](https://www.gtlaw.com/en/insights/2025/11/nydfs-final-cybersecurity-rules-mfa-asset-inventory-and-third-party-risk), [Mitratech](https://mitratech.com/resource-hub/blog/nydfs-23-nycrr-500/)
- GLBA Safeguards Rule service-provider oversight: [FTC](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)
- CIPA / AI voice litigation: [Goodwin](https://www.goodwinlaw.com/en/insights/publications/2025/02/alerts-practices-dpc-ftec-ai-voice-products-subject-to-california-invasion-of-privacy-claims), [Wilson Sonsini](https://www.wsgr.com/en/insights/us-federal-court-allows-cipa-class-action-against-ai-customer-service-provider-to-proceed.html), [The Lyon Firm](https://thelyonfirm.com/blog/ai-call-monitoring-lawsuits-tcpa/)
- AI disclosure laws: [CA SB 1001 — Akin](https://www.akingump.com/en/insights/blogs/ag-data-dive/california-s-new-bot-law-prohibits-use-of-undeclared-bots), [Utah AI Act — Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/utahs-ai-policy-act-now-effective)
- Cyber insurance limits: [Morgan Lewis (Sept 2025)](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2025/09/cyberinsurance-requirements-in-tech-transactions-balancing-risk-and-market-practice)
- Subprocessor posture: [Retell compliance](https://docs.retellai.com/general/compliance), [Anthropic data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) + [ZDR](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to), [Cartesia GDPR](https://cartesia.ai/blog/gdpr-compliance)

*Disclaimer: This is a readiness strategy, not legal advice. Have a qualified privacy/insurance-regulatory attorney review the DPA, call-recording consent design, and any contractual representations before signing.*
