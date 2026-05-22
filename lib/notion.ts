import { Client } from "@notionhq/client";

export const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB_ID = process.env.NOTION_INTAKE_DATABASE_ID!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IntakeState = Record<string, any>;

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

  const taskBlocks = tasks
    .filter((t: IntakeState) => t.name)
    .map((t: IntakeState) => ({
      object: "block" as const,
      type: "bulleted_list_item" as const,
      bulleted_list_item: {
        rich_text: [
          {
            type: "text" as const,
            text: {
              content: `${t.name}${t.frequency ? ` (${t.frequency})` : ""}${t.desc ? " — " + t.desc : ""}`,
            },
          },
        ],
      },
    }));

  const page = await notion.pages.create({
    parent: { database_id: DB_ID },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: `${contact.company || "Unknown"} · Intake · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
            },
          },
        ],
      },
      Status: { status: { name: "New" } },
      "Contact Name": {
        rich_text: [{ text: { content: contact.name || "" } }],
      },
      Email: { rich_text: [{ text: { content: contact.email || "" } }] },
      Company: {
        rich_text: [{ text: { content: contact.company || "" } }],
      },
      Website: { rich_text: [{ text: { content: contact.website || "" } }] },
      Role: { rich_text: [{ text: { content: about.role || "" } }] },
      Industry: about.industry
        ? { select: { name: about.industry } }
        : { select: null },
      "Team Size": {
        rich_text: [{ text: { content: about.teamSize || "" } }],
      },
      Urgency: about.urgency
        ? { select: { name: about.urgency } }
        : { select: null },
      Goals: {
        multi_select: goalsList.map((g: string) => ({ name: g.slice(0, 100) })),
      },
      "Submitted At": {
        date: { start: new Date().toISOString() },
      },
    },
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: `Session: ${sessionId}  ·  Kickoff: ${slotLabel}` } },
          ],
        },
      },
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "Goals (own words)" } }],
        },
      },
      ...(goals.freeText
        ? [
            {
              object: "block" as const,
              type: "paragraph" as const,
              paragraph: {
                rich_text: [
                  { type: "text" as const, text: { content: goals.freeText } },
                ],
              },
            },
          ]
        : []),
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "Top Tasks" } }],
        },
      },
      ...taskBlocks,
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "Software Stack" } }],
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content:
                  (software.selected ?? []).join(", ") +
                  (software.other ? `\nOther: ${software.other}` : ""),
              },
            },
          ],
        },
      },
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "SOPs & Docs" } }],
        },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: {
                content: [
                  sops.files?.length ? `${sops.files.length} file(s) uploaded` : "",
                  sops.pastedText ? `Pasted notes: ${sops.pastedText}` : "",
                  sops.additionalLinks ? `Links: ${sops.additionalLinks}` : "",
                ]
                  .filter(Boolean)
                  .join("\n\n") || "None provided",
              },
            },
          ],
        },
      },
    ],
  });

  return page.id;
}
