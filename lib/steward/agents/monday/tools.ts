import { mondayQuery } from "./client";
import type { AgentTool, ToolContext } from "@/lib/steward/types";

function key(ctx: ToolContext): string {
  const k = ctx.token.api_key;
  if (!k) throw new Error("Monday.com API key not configured for this client.");
  return k;
}

function fmt(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export const mondayTools: AgentTool[] = [
  {
    name: "monday_list_boards",
    description: "List all Monday.com boards the account has access to. Returns board IDs, names, and item counts. Call this first to discover what boards exist before working with items.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max boards to return (default 30, max 100)" },
      },
    },
    async execute(input, ctx) {
      const limit = (input.limit as number) ?? 30;
      const data = await mondayQuery<{ boards: { id: string; name: string; description: string; items_count: number; state: string }[] }>(
        key(ctx),
        `query { boards(limit: ${limit}, state: active) { id name description items_count state } }`
      );
      return fmt(data.boards);
    },
  },

  {
    name: "monday_get_board_schema",
    description: "Get the column structure and groups for a board. Required before updating column values so you know the correct column IDs and value formats.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "The board ID" },
      },
      required: ["board_id"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ boards: { id: string; name: string; columns: unknown[]; groups: unknown[] }[] }>(
        key(ctx),
        `query($id: ID!) { boards(ids: [$id]) { id name columns { id title type } groups { id title color } } }`,
        { id: input.board_id }
      );
      return fmt(data.boards[0] ?? {});
    },
  },

  {
    name: "monday_list_items",
    description: "List items on a board with all column values. Supports optional group filter. Returns up to 100 items including updated_at so you can identify stale items.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "The board ID" },
        limit: { type: "number", description: "Max items (default 50, max 100)" },
        group_id: { type: "string", description: "Optional: filter to a specific group ID" },
      },
      required: ["board_id"],
    },
    async execute(input, ctx) {
      const limit = (input.limit as number) ?? 50;
      const groupFilter = input.group_id
        ? `, query_params: { rules: [{ column_id: "group", compare_value: ["${input.group_id}"] }] }`
        : "";
      const data = await mondayQuery<{ boards: { items_page: { items: unknown[] } }[] }>(
        key(ctx),
        `query($id: ID!) { boards(ids: [$id]) { items_page(limit: ${limit}${groupFilter}) { items { id name state group { id title } column_values { id title text value } updated_at created_at } } } }`,
        { id: input.board_id }
      );
      return fmt(data.boards[0]?.items_page?.items ?? []);
    },
  },

  {
    name: "monday_get_item",
    description: "Get full details of a specific item including column values and recent comments/updates.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "The item ID" },
      },
      required: ["item_id"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ items: unknown[] }>(
        key(ctx),
        `query($id: ID!) { items(ids: [$id]) { id name state board { id name } group { id title } column_values { id title text value } updates(limit: 5) { id text_body created_at creator { name } } updated_at created_at } }`,
        { id: input.item_id }
      );
      return fmt(data.items[0] ?? {});
    },
  },

  {
    name: "monday_search_items",
    description: "Search for items by name across a board. Useful when you need to find a specific item without knowing its ID.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "The board ID to search within" },
        query: { type: "string", description: "Search text to match against item names" },
      },
      required: ["board_id", "query"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ boards: { items_page: { items: unknown[] } }[] }>(
        key(ctx),
        `query($id: ID!, $q: String!) { boards(ids: [$id]) { items_page(limit: 50, query_params: { rules: [{ column_id: "name", compare_value: [$q], operator: contains_text }] }) { items { id name state group { id title } column_values { id title text } updated_at } } } }`,
        { id: input.board_id, q: input.query }
      );
      return fmt(data.boards[0]?.items_page?.items ?? []);
    },
  },

  {
    name: "monday_add_update",
    description: "Add a comment or update message to an item's activity feed. The preferred way to notify assignees or log actions without changing column values.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "The item ID to comment on" },
        body: { type: "string", description: "The message body (plain text or basic markdown)" },
      },
      required: ["item_id", "body"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ create_update: { id: string } }>(
        key(ctx),
        `mutation($itemId: ID!, $body: String!) { create_update(item_id: $itemId, body: $body) { id } }`,
        { itemId: input.item_id, body: input.body }
      );
      return fmt({ created_update_id: data.create_update.id });
    },
  },

  {
    name: "monday_update_item",
    description: "Update a single column value on an item. The value format depends on the column type — use monday_get_board_schema to find column IDs and types first. For status columns, value is the label string. For text columns, value is a plain string.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "The board ID" },
        item_id: { type: "string", description: "The item ID" },
        column_id: { type: "string", description: "The column ID to update" },
        value: { type: "string", description: "JSON-encoded value in Monday's format. For text: '\"my text\"'. For status: '{\"label\":\"Done\"}'. For date: '{\"date\":\"2026-05-22\"}'." },
      },
      required: ["board_id", "item_id", "column_id", "value"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ change_column_value: { id: string } }>(
        key(ctx),
        `mutation($boardId: ID!, $itemId: ID!, $colId: String!, $val: JSON!) { change_column_value(board_id: $boardId, item_id: $itemId, column_id: $colId, value: $val) { id } }`,
        { boardId: input.board_id, itemId: input.item_id, colId: input.column_id, val: input.value }
      );
      return fmt({ updated_item_id: data.change_column_value.id });
    },
  },

  {
    name: "monday_create_item",
    description: "Create a new item in a board group. Returns the new item's ID.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "The board ID" },
        group_id: { type: "string", description: "The group ID to create the item in" },
        name: { type: "string", description: "The item name" },
        column_values: { type: "string", description: "Optional JSON object of column_id → value pairs" },
      },
      required: ["board_id", "group_id", "name"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ create_item: { id: string; name: string } }>(
        key(ctx),
        `mutation($boardId: ID!, $groupId: String!, $name: String!, $cols: JSON) { create_item(board_id: $boardId, group_id: $groupId, item_name: $name, column_values: $cols) { id name } }`,
        { boardId: input.board_id, groupId: input.group_id, name: input.name, cols: input.column_values ?? null }
      );
      return fmt(data.create_item);
    },
  },

  {
    name: "monday_move_item_to_group",
    description: "Move an item to a different group within the same board — useful for workflow transitions like moving from 'In Progress' to 'Done'.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "The item ID to move" },
        group_id: { type: "string", description: "The destination group ID" },
      },
      required: ["item_id", "group_id"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ move_item_to_group: { id: string } }>(
        key(ctx),
        `mutation($itemId: ID!, $groupId: String!) { move_item_to_group(item_id: $itemId, group_id: $groupId) { id } }`,
        { itemId: input.item_id, groupId: input.group_id }
      );
      return fmt({ moved_item_id: data.move_item_to_group.id });
    },
  },

  {
    name: "monday_archive_item",
    description: "Archive an item, removing it from active views. The item is preserved but hidden. Use for completed or permanently stale items.",
    inputSchema: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "The item ID to archive" },
      },
      required: ["item_id"],
    },
    async execute(input, ctx) {
      const data = await mondayQuery<{ archive_item: { id: string } }>(
        key(ctx),
        `mutation($itemId: ID!) { archive_item(item_id: $itemId) { id } }`,
        { itemId: input.item_id }
      );
      return fmt({ archived_item_id: data.archive_item.id });
    },
  },
];
