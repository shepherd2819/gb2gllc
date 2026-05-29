// Bundled fallback for the master contract template. Used when the
// Notion master page is unreachable or missing a required section.
// Section keys must match exactly what lib/vera/template.ts looks for.

export type SectionKey =
  | "preamble"
  | "scope_of_work"
  | "fees"
  | "intellectual_property"
  | "ai_disclaimer"
  | "confidentiality"
  | "term_and_termination"
  | "authority_to_sign"
  | "governing_law";

export const DEFAULT_SECTIONS: Record<SectionKey, string> = {
  preamble:
    'Between: Oberon Analytics LLC, a South Carolina limited liability company, doing business as GB2GLLC ("GB2GLLC"), and {{client_company}} ("Client"). Effective on the date Client signs below.',
  scope_of_work:
    "GB2GLLC will provide {{product_label}} services to Client. {{scope_paragraph}}",
  fees:
    "Client will pay GB2GLLC {{amount_formatted}} {{cadence_label}}. Invoices are due Net-15 from the date of issue.",
  intellectual_property:
    "GB2GLLC owns, in full, all software, code, models, prompts, design assets, methodologies, and other work product created under this Agreement. Client receives a perpetual, worldwide, royalty-free license to use the deliverables for Client's own business purposes.",
  ai_disclaimer:
    'GB2GLLC\'s services may use third-party AI providers (such as Anthropic, OpenAI, Google, and others). These systems can produce inaccurate, incomplete, or unexpected outputs ("hallucinations"). GB2GLLC is not responsible for any third-party AI output, and Client is responsible for reviewing AI-generated content before relying on it.',
  confidentiality:
    "Each party will keep the other's non-public information confidential and use it only as needed to perform this Agreement.",
  term_and_termination:
    "This Agreement begins on the date Client signs below. Either party may end it by giving the other at least thirty (30) days' written notice. Fees earned through the termination date remain payable.",
  authority_to_sign:
    "By signing below, {{signer_name}} confirms that they have full legal authority to represent {{client_company}} and to enter into this Agreement on its behalf.",
  governing_law:
    "This Agreement is governed by the laws of the State of South Carolina, without regard to its conflict-of-laws principles.",
};

export const SECTION_TITLES: Record<SectionKey, string> = {
  preamble:              "GB2GLLC Services Agreement",
  scope_of_work:         "1. Scope of Work",
  fees:                  "2. Fees",
  intellectual_property: "3. Intellectual Property",
  ai_disclaimer:         "4. Third-Party AI Disclaimer",
  confidentiality:       "5. Confidentiality",
  term_and_termination:  "6. Term and Termination",
  authority_to_sign:     "7. Authority to Sign",
  governing_law:         "8. Governing Law",
};

export const SECTION_ORDER: SectionKey[] = [
  "preamble",
  "scope_of_work",
  "fees",
  "intellectual_property",
  "ai_disclaimer",
  "confidentiality",
  "term_and_termination",
  "authority_to_sign",
  "governing_law",
];
