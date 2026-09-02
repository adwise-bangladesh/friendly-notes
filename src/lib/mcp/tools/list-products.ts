import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, requireAuth } from "../supabase";

export default defineTool({
  name: "list_products",
  title: "List products",
  description: "Search the product catalog by name or SKU, optionally filtered by status.",
  inputSchema: {
    search: z.string().trim().optional().describe("Match against product name or SKU."),
    status: z.enum(["draft", "active", "archived"]).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, status, limit }, ctx) => {
    const supabase = requireAuth(ctx);
    let query = supabase
      .from("products")
      .select(
        "id, name, slug, sku, status, visibility, product_type, supply_model, price, compare_at_price, is_purchasable, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(limit ?? 25);
    if (status) query = query.eq("status", status);
    if (search) query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return jsonResult({ count: data?.length ?? 0, products: data ?? [] });
  },
});
