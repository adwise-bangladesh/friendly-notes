import { supabase } from "@/integrations/supabase/client";
import type {
  Brand,
  BrandStatus,
  Category,
  CategoryStatus,
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
