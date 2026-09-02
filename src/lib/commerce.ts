import { supabase } from "@/integrations/supabase/client";
import type {
  Brand,
  BrandInsert,
  BrandStatus,
  BrandUpdate,
  Category,
  CategoryInsert,
  CategoryStatus,
  CategoryUpdate,
  EntityVisibility,
  InternalProduct,
  InternalProductWithRelations,
  ProductStatus,
  PublicProduct,
} from "@/types/commerce";

/**
 * Data access foundation for commerce entities.
 * All calls go through the authenticated browser client, so Row Level Security
 * (viewer = read, staff = read/write, admin & owner = full) applies as the
 * signed-in user. No public/unauthenticated access path exists by design.
 */

const CATEGORY_FIELDS = "*";
const BRAND_FIELDS = "*";

/**
 * PRODUCT QUERY CONTRACTS (Step 4.2)
 *
 * INTERNAL — admin / operations. May include cost columns (base_cost,
 * additional_cost, estimated_landed_cost). Never reuse for a storefront.
 *
 * PUBLIC — storefront / mobile safe. Explicit projection that must never
 * contain a cost column, on the product or on its variants.
 */
export const INTERNAL_PRODUCT_SELECT = "*";

export const INTERNAL_PRODUCT_WITH_RELATIONS_SELECT = `
  *,
  brand:brands(*),
  product_categories(*, category:categories(*)),
  product_variants(*),
  product_media(*)
`;

export const PUBLIC_PRODUCT_SELECT = `
  id, name, slug, short_description, description, price, compare_at_price,
  is_purchasable, status, visibility, product_type, supply_model, requires_shipping,
  brand:brands(id, name, slug),
  product_categories(is_primary, category:categories(id, name, slug)),
  product_variants(id, title, sku, price, compare_at_price, status, sort_order),
  product_media(url, alt_text, is_primary, sort_order)
`;

export interface ListOptions<TStatus extends string = string> {
  status?: TStatus;
  visibility?: EntityVisibility;
  search?: string;
  limit?: number;
}

/* ---------- Categories ---------- */

export async function getCategories(options: ListOptions<CategoryStatus> = {}): Promise<Category[]> {
  let query = supabase
    .from("categories")
    .select(CATEGORY_FIELDS)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (options.status) query = query.eq("status", options.status);
  if (options.visibility) query = query.eq("visibility", options.visibility);
  if (options.search) query = query.ilike("name", `%${options.search}%`);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getCategoryById(id: string): Promise<Category | null> {
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_FIELDS)
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ---------- Brands ---------- */

export async function getBrands(options: ListOptions<BrandStatus> = {}): Promise<Brand[]> {
  let query = supabase
    .from("brands")
    .select(BRAND_FIELDS)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (options.status) query = query.eq("status", options.status);
  if (options.visibility) query = query.eq("visibility", options.visibility);
  if (options.search) query = query.ilike("name", `%${options.search}%`);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const { data, error } = await supabase
    .from("brands")
    .select(BRAND_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getBrandBySlug(slug: string): Promise<Brand | null> {
  const { data, error } = await supabase
    .from("brands")
    .select(BRAND_FIELDS)
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/* ---------- Products: INTERNAL (admin / operations, includes costs) ---------- */

export async function getInternalProducts(
  options: ListOptions<ProductStatus> = {},
): Promise<InternalProduct[]> {
  let query = supabase
    .from("products")
    .select(INTERNAL_PRODUCT_SELECT)
    .order("created_at", { ascending: false });

  if (options.status) query = query.eq("status", options.status);
  if (options.visibility) query = query.eq("visibility", options.visibility);
  if (options.search) query = query.ilike("name", `%${options.search}%`);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getInternalProductById(
  id: string,
): Promise<InternalProductWithRelations | null> {
  const { data, error } = await supabase
    .from("products")
    .select(INTERNAL_PRODUCT_WITH_RELATIONS_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  // Narrowing: PostgREST embeds are untyped at this depth; shape matches
  // INTERNAL_PRODUCT_WITH_RELATIONS_SELECT above.
  return (data as unknown as InternalProductWithRelations | null) ?? null;
}

export async function getInternalProductBySlug(
  slug: string,
): Promise<InternalProductWithRelations | null> {
  const { data, error } = await supabase
    .from("products")
    .select(INTERNAL_PRODUCT_WITH_RELATIONS_SELECT)
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as InternalProductWithRelations | null) ?? null;
}

/* ---------- Products: PUBLIC-SAFE (no cost data, product or variant) ---------- */

/**
 * The only product read a future storefront / mobile client should reuse.
 * Availability still has to be enforced by the caller via isProductPurchasable().
 */
export async function getPublicProductBySlug(slug: string): Promise<PublicProduct | null> {
  const { data, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  // Narrowing: shape is fixed by PUBLIC_PRODUCT_SELECT — cost columns absent.
  return (data as unknown as PublicProduct | null) ?? null;
}

export async function getPublicProducts(
  options: Pick<ListOptions<ProductStatus>, "search" | "limit"> = {},
): Promise<PublicProduct[]> {
  let query = supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("status", "active")
    .eq("visibility", "visible")
    .order("name", { ascending: true });

  if (options.search) query = query.ilike("name", `%${options.search}%`);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as PublicProduct[];
}


/* ---------- Shared helpers ---------- */

/** Normalises a display name into a URL-safe slug matching the DB constraint. */
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ---------- Product counts (single round trip each) ---------- */

export async function getCategoryProductCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("category_product_counts");
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data ?? []) map[row.category_id] = Number(row.product_count);
  return map;
}

export async function getBrandProductCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("brand_product_counts");
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data ?? []) map[row.brand_id] = Number(row.product_count);
  return map;
}

/* ---------- Slug uniqueness ---------- */

export async function isSlugAvailable(
  table: "categories" | "brands",
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  let query = supabase.from(table).select("id").eq("slug", slug).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length === 0;
}

/* ---------- Category mutations ---------- */

export async function createCategory(input: CategoryInsert): Promise<Category> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("categories")
    .insert({ ...input, created_by: userData.user?.id ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id: string, input: CategoryUpdate): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export const archiveCategory = (id: string) => updateCategory(id, { status: "archived" });
export const restoreCategory = (id: string) => updateCategory(id, { status: "active" });

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- Brand mutations ---------- */

export async function createBrand(input: BrandInsert): Promise<Brand> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("brands")
    .insert({ ...input, created_by: userData.user?.id ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateBrand(id: string, input: BrandUpdate): Promise<Brand> {
  const { data, error } = await supabase
    .from("brands")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export const archiveBrand = (id: string) => updateBrand(id, { status: "archived" });
export const restoreBrand = (id: string) => updateBrand(id, { status: "active" });

export async function deleteBrand(id: string): Promise<void> {
  const { error } = await supabase.from("brands").delete().eq("id", id);
  if (error) throw error;
}
