import { Client } from "@notionhq/client";
import {
  DEFAULT_SECTIONS,
  SECTION_ORDER,
  SECTION_TITLES,
  type SectionKey,
} from "./master-template-defaults";

export type SubstitutionVars = {
  client_company: string;
  product_label: string;
  scope_paragraph: string;
  amount_formatted: string;
  cadence_label: string;
  generated_date: string;
  signer_name: string;
  signer_representing: string;
  signed_date: string;
};

export type LoadedTemplate = {
  sections: Record<SectionKey, string>;
  version: string; // "notion:<pageId>@<iso>" | "bundled:<git_sha or 'unknown'>"
};

export function substituteSection(text: string, vars: Partial<Record<string, string>>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== undefined
      ? String(vars[key])
      : `{{${key}}}`
  );
}

export function fallbackSections(): LoadedTemplate {
  return {
    sections: { ...DEFAULT_SECTIONS },
    version: `bundled:${process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown"}`,
  };
}

// Loads from Notion, falls back on any error.
export async function loadMasterTemplate(
  notion: Client = new Client({ auth: process.env.NOTION_TOKEN })
): Promise<LoadedTemplate> {
  const pageId = process.env.NOTION_CONTRACT_TEMPLATE_PAGE_ID;
  if (!pageId) return fallbackSections();

  try {
    const sections = { ...DEFAULT_SECTIONS };
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });

    let currentKey: SectionKey | null = null;
    let buffer: string[] = [];

    const flush = () => {
      if (currentKey && buffer.length > 0) {
        sections[currentKey] = buffer.join("\n").trim();
      }
    };

    for (const block of blocks.results) {
      const b = block as {
        type?: string;
        heading_2?: { rich_text: { plain_text: string }[] };
        paragraph?: { rich_text: { plain_text: string }[] };
      };
      if (b.type === "heading_2") {
        flush();
        const title = (b.heading_2?.rich_text ?? []).map((r) => r.plain_text).join("").trim();
        const matched = SECTION_ORDER.find(
          (k) => SECTION_TITLES[k].toLowerCase() === title.toLowerCase()
        );
        currentKey = matched ?? null;
        buffer = [];
      } else if (b.type === "paragraph" && currentKey) {
        const text = (b.paragraph?.rich_text ?? []).map((r) => r.plain_text).join("");
        if (text) buffer.push(text);
      }
    }
    flush();

    return {
      sections,
      version: `notion:${pageId}@${new Date().toISOString()}`,
    };
  } catch (err) {
    console.warn(
      "[vera/template] Notion load failed, using bundled defaults:",
      err instanceof Error ? err.message : err
    );
    return fallbackSections();
  }
}

export function renderSection(
  key: SectionKey,
  sections: Record<SectionKey, string>,
  vars: Partial<SubstitutionVars>
): string {
  return substituteSection(sections[key], vars);
}

export { SECTION_ORDER, SECTION_TITLES, type SectionKey };
