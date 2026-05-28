// lib/slack-builders.ts
//
// Slack Block Kit message builders. Pure functions, fully testable.
// Add a new builder per use case rather than overgrowing one.

import type { SlackBlock } from "./slack";

const BODY_SNIPPET_LIMIT = 200;

export function portalTicketNotificationBlocks(opts: {
  client: { name: string | null; company: string | null };
  subject: string;
  body: string;
  ticketId: string;
  adminUrl: string;
}): SlackBlock[] {
  const who = [opts.client.name, opts.client.company].filter(Boolean).join(" · ") || "(unknown client)";
  const snippet = opts.body.length > BODY_SNIPPET_LIMIT
    ? `${opts.body.slice(0, BODY_SNIPPET_LIMIT)}…`
    : opts.body;
  return [
    { type: "section", text: { type: "mrkdwn", text: `*New ticket from ${who}*` } },
    { type: "section", text: { type: "mrkdwn", text: `*${escape(opts.subject)}*\n${escape(snippet)}` } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in admin" },
          url: `${opts.adminUrl}/support/${opts.ticketId}`,
        },
      ],
    },
  ];
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
