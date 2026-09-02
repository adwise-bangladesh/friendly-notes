import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, requireAuth } from "../supabase";

export default defineTool({
  name: "add_order_note",
  title: "Add order note",
  description: "Append an internal note to an order's timeline. Notes cannot be edited or removed.",
  inputSchema: {
    order_id: z.string().uuid(),
    note: z.string().trim().min(1).max(2000),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ order_id, note }, ctx) => {
    const supabase = requireAuth(ctx);
    const { data, error } = await supabase
      .from("order_notes")
      .insert({ order_id, note, created_by: ctx.getUserId() })
      .select("id, order_id, note, created_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return jsonResult({ note: data });
  },
});
