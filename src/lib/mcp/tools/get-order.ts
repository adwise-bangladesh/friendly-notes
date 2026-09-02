import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, requireAuth } from "../supabase";

export default defineTool({
  name: "get_order",
  title: "Get order",
  description:
    "Fetch one order with its shipping address snapshot, line items and note timeline, by id or order number.",
  inputSchema: {
    id: z.string().uuid().optional(),
    order_number: z.string().trim().optional().describe("e.g. ORD-20260902-000001"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, order_number }, ctx) => {
    if (!id && !order_number) throw new Error("Provide either id or order_number");
    const supabase = requireAuth(ctx);
    let query = supabase
      .from("orders")
      .select("*, address:order_addresses(*), items:order_items(*), notes:order_notes(*)")
      .limit(1);
    query = id ? query.eq("id", id) : query.eq("order_number", order_number!);

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Order not found");
    return jsonResult({ order: data });
  },
});
