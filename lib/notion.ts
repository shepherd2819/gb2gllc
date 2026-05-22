import { Client } from "@notionhq/client";

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB_ID = process.env.NOTION_INTAKE_DATABASE_ID!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IntakeState = Record<string, any>;

export interface IntakeFile {
  name: string;
  size: number;
  storage_path: string;
}

function para(content: string) {
  // Notion text blocks max 2000 chars
  const safe = (content || "—").slice(0, 2000);
  return {
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: {
      rich_text: [{ type: "text" as const, text: { content: safe } }],
    },
  };
}

function h2(content: string) {
  return {
    object: "block" as const,
    type: "heading_2" as const,
    heading_2: {
      rich_text: [{ type: "text" as const, text: { content } }],
    },
  };
}

function bullet(content: string) {
  return {
    object: "block" as const,
    type: "bulleted_list_item" as const,
    bulleted_list_item: {
      rich_text: [{ type: "text" as const, text: { content: content.slice(0, 2000) } }],
    },
  };
}

function divider() {
  return { object: "block" as const, type: "divider" as const, divider: {} };
}

export async function createIntakePage(
  sessionId: string,
  state: IntakeState,
  files: IntakeFile[] = []
) {
  const contact = state.contact ?? {};
  const about = state.about ?? {};
  const goals = state.goals ?? {};
  const software = state.software ?? {};
  const tasks: IntakeState[] = state.tasks ?? [];
  const sops = state.sops ?? {};
  const schedule = state.schedule ?? {};

  const slotLabel = schedule.slot
    ? new Date(parseInt(schedule.slot)).toLocaleString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "TBD";

  const goalsList: string[] = goals.selected ?? [];

  const taskBlocks = tasks.filter((t) => t.name).map((t) =>
    bullet(
      `${t.name}${t.frequency ? ` (${t.frequency})` : ""}${t.desc ? " — " + t.desc : ""}`
    )
  );

  const fileBlocks =
    files.length > 0
      ? files.map((f) =>
          bullet(
            `${f.name} (${(f.size / 1024).toFixed(0)} KB) · path: ${f.storage_path}`
          )
        )
      : [para("No files uploaded")];

  const softwareList =
    [
      (software.selected ?? []).join(", "),
      software.other ? `Other: ${software.other}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "None provided";

  // Step 1: create the page (title only — body blocks go in step 2)
  const page = await notion.pages.create({
    parent: { database_id: DB_ID },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: `${contact.company || contact.name || "Unknown"} · Intake · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
            },
          },
        ],
      },
    },
  });

  // Step 2: append all content blocks
  await notion.blocks.children.append({
    block_id: page.id,
    children: [
      h2("Contact"),
      para(`Name: ${contact.name || "—"}`),
      para(`Email: ${contact.email || "—"}`),
      para(`Company: ${contact.company || "—"}`),
      para(`Website: ${contact.website || "—"}`),
      para(`Role: ${about.role || "—"}`),
      divider(),

      h2("About"),
      para(`Industry: ${about.industry || "—"}`),
      para(`Team Size: ${about.teamSize || "—"}`),
      para(`Urgency: ${about.urgency || "—"}`),
      divider(),

      h2("Goals"),
      para(`Selected: ${goalsList.join(", ") || "—"}`),
      ...(goals.freeText ? [para(goals.freeText)] : []),
      divider(),

      h2("Top Tasks"),
      ...(taskBlocks.length ? taskBlocks : [para("None provided")]),
      divider(),

      h2("Software Stack"),
      para(softwareList),
      divider(),

      h2("SOPs & Docs"),
      ...fileBlocks,
      ...(sops.pastedText ? [para(`Pasted notes:\n${sops.pastedText}`)] : []),
      ...(sops.additionalLinks ? [para(`Links: ${sops.additionalLinks}`)] : []),
      divider(),

      h2("Kickoff Call"),
      para(slotLabel),
      divider(),

      h2("Meta"),
      para(`Session ID: ${sessionId}`),
      para(`Submitted: ${new Date().toLocaleString("en-US")}`),
    ],
  });

  return page.id;
}
