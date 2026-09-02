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
  ProductStatus,
  Product,
  ProductWithRelations,
} from "@/types/commerce";

/**
 * Data access foundation for commerce entities.
 * All calls go through the authenticated browser client, so Row Level Security
 * (viewer = read, staff = read/write, admin & owner = full) applies as the
 * signed-in user. No public/unauthenticated access path exists by design.
 */

const CATEGORY_FIELDS = "*";
const BRAND_FIELDS = "*";
const PRODUCT_FIELDS = "*";
const PRODUCT_WITH_RELATIONS = `
  *,
  brand:brands(*),
  product_categories(*, category:categories(*)),
  product_variants(*),
  product_media(*)
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

/* ---------- Products ---------- */

export async function getProducts(options: ListOptions<ProductStatus> = {}): Promise<Product[]> {
  let query = supabase
    .from("products")
    .select(PRODUCT_FIELDS)
    .order("created_at", { ascending: false });

  if (options.status) query = query.eq("status", options.status);
  if (options.visibility) query = query.eq("visibility", options.visibility);
  if (options.search) query = query.ilike("name", `%${options.search}%`);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getProductById(id: string): Promise<ProductWithRelations | null> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_WITH_RELATIONS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ProductWithRelations | null) ?? null;
}

export async function getProductBySlug(slug: string): Promise<ProductWithRelations | null> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_WITH_RELATIONS)
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data as ProductWithRelations | null) ?? null;
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
