import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERALD_PRODUCT,
  HERALD_SOURCE,
  isValidEmail,
  heraldAnswers,
  planHeraldAutomation,
} from "./herald";

test("constants", () => {
  assert.equal(HERALD_PRODUCT, "herald");
  assert.equal(HERALD_SOURCE, "herald-link");
});

test("isValidEmail accepts plausible emails and rejects junk", () => {
  assert.equal(isValidEmail("jo@acme.com"), true);
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
  assert.equal(isValidEmail(42), false);
});

test("heraldAnswers shapes a full state", () => {
  const state = {
    herald: {
      website: { url: "https://acme.com", platform: "WordPress", snippetAccess: "I can" },
      knowledge: { services: "Plumbing", faqs: "Pricing?", hours: "9-5", policies: "No refunds" },
      voice: { agentName: "Pipes", tone: "Friendly", avoid: "slang" },
      leads: { destination: "Email", contact: "jo@acme.com", bookingLink: "https://cal.com/acme" },
    },
  };
  const a = heraldAnswers(state);
  assert.equal(a.website.url, "https://acme.com");
  assert.equal(a.knowledge.services, "Plumbing");
  assert.equal(a.voice.agentName, "Pipes");
  assert.equal(a.leads.bookingLink, "https://cal.com/acme");
});

test("heraldAnswers tolerates missing/garbage sub-trees", () => {
  assert.equal(heraldAnswers({}).voice.agentName, "");
  assert.equal(heraldAnswers({ herald: null as unknown as Record<string, unknown> }).website.url, "");
  assert.equal(heraldAnswers({ herald: { voice: { agentName: 7 } } }).voice.agentName, "");
});

const freshClient = { chatbot_agent_name: null, invited_at: null };

test("planHeraldAutomation: happy path enables all three", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "Pipes",
    client: freshClient,
  });
  assert.deepEqual(plan, { enableProduct: true, setAgentName: "Pipes", sendInvite: true });
});

test("planHeraldAutomation: non-herald session does nothing", () => {
  const plan = planHeraldAutomation({
    intendedProduct: null,
    email: "jo@acme.com",
    agentName: "Pipes",
    client: freshClient,
  });
  assert.deepEqual(plan, { enableProduct: false, setAgentName: null, sendInvite: false });
});

test("planHeraldAutomation: invalid email does nothing", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "junk",
    agentName: "Pipes",
    client: freshClient,
  });
  assert.deepEqual(plan, { enableProduct: false, setAgentName: null, sendInvite: false });
});

test("planHeraldAutomation: missing client does nothing", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "Pipes",
    client: null,
  });
  assert.deepEqual(plan, { enableProduct: false, setAgentName: null, sendInvite: false });
});

test("planHeraldAutomation: existing agent name is never overwritten", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "Pipes",
    client: { chatbot_agent_name: "Existing", invited_at: null },
  });
  assert.equal(plan.setAgentName, null);
  assert.equal(plan.enableProduct, true);
});

test("planHeraldAutomation: already-invited client is not re-invited", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "",
    client: { chatbot_agent_name: null, invited_at: "2026-01-01T00:00:00Z" },
  });
  assert.equal(plan.sendInvite, false);
  assert.equal(plan.enableProduct, true);
});

test("planHeraldAutomation: blank/whitespace agent name maps to null", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "   ",
    client: freshClient,
  });
  assert.equal(plan.setAgentName, null);
});

test("planHeraldAutomation: agent name is trimmed", () => {
  const plan = planHeraldAutomation({
    intendedProduct: "herald",
    email: "jo@acme.com",
    agentName: "  Pipes  ",
    client: freshClient,
  });
  assert.equal(plan.setAgentName, "Pipes");
});
