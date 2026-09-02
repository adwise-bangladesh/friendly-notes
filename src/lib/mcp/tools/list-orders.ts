import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, requireAuth } from "../supabase";

export default defineTool({
  name: "list_orders",
  title: "List orders",
  description:
    "List recent orders with their status dimensions and totals. Filter by status, payment status or customer search.",
  inputSchema: {
    search: z.string().trim().optional().describe("Order number, customer name or phone."),
    status: z.enum(["draft", "created", "cancelled"]).optional(),
    payment_status: z.string().trim().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, status, payment_status, limit }, ctx) => {
    const supabase = requireAuth(ctx);
    let query = supabase
      .from("orders")
      .select(
        `id, order_number, customer_name, customer_phone, status, verification_status,
         fulfillment_status, delivery_status, financial_status, payment_method, payment_status,
         subtotal, grand_total, paid_amount, due_amount, placed_at, created_at`,
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (status) query = query.eq("status", status);
    if (payment_status) query = query.eq("payment_status", payment_status);
    if (search) {
      query = query.or(
        `order_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return jsonResult({ count: data?.length ?? 0, orders: data ?? [] });
  },
});
