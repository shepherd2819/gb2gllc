import { Client } from "@notionhq/client";

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB_ID = process.env.NOTION_INTAKE_DATABASE_ID!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IntakeState = Record<string, any>;

function para(content: string) {
  return {
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: {
      rich_text: [{ type: "text" as const, text: { content: content || "—" } }],
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
      rich_text: [{ type: "text" as const, text: { content } }],
    },
  };
}

export async function createIntakePage(sessionId: string, state: IntakeState) {
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

  const sopSummary = [
    sops.files?.length ? `${sops.files.length} file(s) uploaded` : "",
    sops.pastedText ? `Notes: ${sops.pastedText}` : "",
    sops.additionalLinks ? `Links: ${sops.additionalLinks}` : "",
  ]
    .filter(Boolean)
    .join("\n\n") || "None provided";

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
    children: [
      h2("Contact"),
      para(`Name: ${contact.name || "—"}`),
      para(`Email: ${contact.email || "—"}`),
      para(`Company: ${contact.company || "—"}`),
      para(`Website: ${contact.website || "—"}`),
      para(`Role: ${about.role || "—"}`),

      h2("About"),
      para(`Industry: ${about.industry || "—"}`),
      para(`Team Size: ${about.teamSize || "—"}`),
      para(`Urgency: ${about.urgency || "—"}`),

      h2("Goals"),
      para(`Selected: ${goalsList.join(", ") || "—"}`),
      ...(goals.freeText ? [para(goals.freeText)] : []),

      h2("Top Tasks"),
      ...(taskBlocks.length ? taskBlocks : [para("None provided")]),

      h2("Software Stack"),
      para(
        [
          (software.selected ?? []).join(", "),
          software.other ? `Other: ${software.other}` : "",
        ]
          .filter(Boolean)
          .join("\n") || "None provided"
      ),

      h2("SOPs & Docs"),
      para(sopSummary),

      h2("Kickoff"),
      para(slotLabel),

      h2("Meta"),
      para(`Session ID: ${sessionId}`),
      para(`Submitted: ${new Date().toISOString()}`),
    ],
  });

  return page.id;
}
