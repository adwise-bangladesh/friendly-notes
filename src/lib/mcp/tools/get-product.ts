import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { jsonResult, requireAuth } from "../supabase";

export default defineTool({
  name: "get_product",
  title: "Get product",
  description: "Fetch one product with its variants, media, brand and categories, by id or slug.",
  inputSchema: {
    id: z.string().uuid().optional().describe("Product id."),
    slug: z.string().trim().optional().describe("Product slug, used when no id is given."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, slug }, ctx) => {
    if (!id && !slug) throw new Error("Provide either id or slug");
    const supabase = requireAuth(ctx);
    let query = supabase
      .from("products")
      .select(
        `*, brand:brands(id, name, slug),
         product_categories(is_primary, category:categories(id, name, slug)),
         product_variants(*), product_media(*)`,
      )
      .limit(1);
    query = id ? query.eq("id", id) : query.eq("slug", slug!);

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Product not found");
    return jsonResult({ product: data });
  },
});
