import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, requireAuth } from "../supabase";

export default defineTool({
  name: "inventory_overview",
  title: "Inventory overview",
  description:
    "List stock records across locations with on-hand, reserved, damaged, incoming and available quantities. Can be limited to low-stock items only.",
  inputSchema: {
    location_code: z.string().trim().optional().describe("Filter to one location by its code."),
    low_stock_only: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ location_code, low_stock_only, limit }, ctx) => {
    const supabase = requireAuth(ctx);
    const { data, error } = await supabase
      .from("inventory_levels")
      .select(
        `id, on_hand, reserved, damaged, incoming, available_quantity, low_stock_threshold,
         location:inventory_locations(id, name, code, status),
         product:products(id, name, sku, status),
         variant:product_variants(id, title, sku, product:products(id, name))`,
      )
      .limit(limit ?? 50);
    if (error) throw new Error(error.message);

    let rows = data ?? [];
    if (location_code) {
      const code = location_code.toLowerCase();
      rows = rows.filter((r) => r.location?.code?.toLowerCase() === code);
    }
    if (low_stock_only) {
      rows = rows.filter(
        (r) =>
          r.low_stock_threshold != null && (r.available_quantity ?? 0) <= r.low_stock_threshold,
      );
    }
    return jsonResult({ count: rows.length, levels: rows });
  },
});
