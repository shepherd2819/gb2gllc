export type Product = "herald" | "atrium" | "steward" | "custom";

export const PRODUCT_LABELS: Record<Product, string> = {
  herald:  "Herald",
  atrium:  "Atrium",
  steward: "Steward",
  custom:  "Custom",
};

export const DEFAULT_SCOPE: Record<Product, string> = {
  herald:
    "GB2GLLC will provide Client with the Herald AI website chatbot service, including initial setup, ongoing tuning, and a monthly performance digest. GB2GLLC will respond to Client requests through standard support channels.",
  atrium:
    "GB2GLLC will design and build a website for Client per the scope agreed in writing prior to engagement, including discovery, design, build, and launch. Hosting and ongoing maintenance are not included unless added in a separate agreement.",
  steward:
    "GB2GLLC will configure and operate Client-specific AI Employee instances under the Steward platform, including agent setup, ongoing supervision, and a monthly activity report.",
  custom:
    "GB2GLLC will provide Client the services described in the engagement notes below and in any related written communications between the parties.",
};
