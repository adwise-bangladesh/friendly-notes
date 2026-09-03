import { supabase } from "@/integrations/supabase/client";
import { toSlug } from "./commerce";
import { removeCommerceMedia } from "./media";
import { variantFromPrice } from "@/types/commerce";
import type {
  ProductDraft,
  ProductEditorRecord,
  ProductListRow,
  ProductPickerOption,
  ProductStatus,
} from "@/types/commerce";

/**
 * Product data access. Every call runs through the authenticated browser
 * client so RLS (viewer = read, staff = manage, admin/owner = full) applies.
 * The list and editor reads each use a single relational query — no N+1.
 *
 * INTERNAL vs PUBLIC: cost columns (base_cost, additional_cost,
 * estimated_landed_cost) are admin-only. `PUBLIC_PRODUCT_SELECT` below is the
 * projection a future storefront/mobile API should use — it never includes
 * cost fields. Do not add cost columns to it.
 */

const LIST_SELECT = `
  id, name, slug, sku, product_type, supply_model, status, visibility,
  featured, is_purchasable, price, compare_at_price, updated_at,
  brand:brands(id, name),
  product_categories(is_primary, category:categories(id, name)),
  product_media(url, is_primary, sort_order),
  product_variants(id, price, sku)
`;

/** Safe column list for any future customer-facing query. No cost fields. */
export const PUBLIC_PRODUCT_SELECT = `
  id, name, slug, short_description, description, price, compare_at_price,
  is_purchasable, product_type, supply_model
`;

const EDITOR_SELECT = `
  *,
  product_categories(*),
  product_variants(*, product_media(*)),
  product_media(*),
  product_relationships!product_relationships_product_id_fkey(
    *,
    related_product:products!product_relationships_related_product_id_fkey(
      id, name, slug, status, product_media(url, is_primary)
    )
  ),
  bundle_items!bundle_items_bundle_product_id_fkey(
    *,
    product:products!bundle_items_product_id_fkey(
      id, name, product_media(url, is_primary)
    ),
    variant:product_variants!bundle_items_variant_id_fkey(
      id, title, product:products(id, name), product_media(url, is_primary)
    )
  )
`;

export async function listProducts(): Promise<ProductListRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select(LIST_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ProductListRow[];
}

export async function getProductEditorRecord(id: string): Promise<ProductEditorRecord | null> {
  const { data, error } = await supabase
    .from("products")
    .select(EDITOR_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const record = data as unknown as ProductEditorRecord;
  // Product-level media only: variant rows arrive nested on their variant.
  record.product_media = (record.product_media ?? []).filter((m) => m.product_id !== null);
  return record;
}

/** Lightweight options for the related-product / bundle-content pickers. */
export async function searchProductOptions(
  term: string,
  excludeId?: string,
  opts?: { excludeBundles?: boolean },
): Promise<ProductPickerOption[]> {
  let query = supabase
    .from("products")
    .select(
      "id, name, slug, status, product_type, product_media(url, is_primary), product_variants(id, title)",
    )
    .neq("status", "archived")
    .order("name", { ascending: true })
    .limit(20);

  if (term.trim()) query = query.ilike("name", `%${term.trim()}%`);
  if (excludeId) query = query.neq("id", excludeId);
  if (opts?.excludeBundles) query = query.neq("product_type", "bundle");

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ProductPickerOption[];
}

export async function isProductSlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
  let query = supabase.from("products").select("id").eq("slug", slug).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length === 0;
}

export async function isProductSkuAvailable(sku: string, excludeId?: string): Promise<boolean> {
  let query = supabase.from("products").select("id").ilike("sku", sku).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length === 0;
}

/* ---------- Save ---------- */

/**
 * Client-side pre-checks. These are convenience only — the authoritative
 * validation and the whole write live in the `save_product_catalog` database
 * function, which applies every change in ONE transaction.
 */
function validate(draft: ProductDraft) {
  if (!draft.name.trim()) throw new Error("Product name is required.");
  if (!toSlug(draft.slug || draft.name)) throw new Error("A valid slug is required.");
  if (draft.price < 0) throw new Error("Regular selling price cannot be negative.");
  if (draft.base_cost < 0 || draft.additional_cost < 0)
    throw new Error("Costs cannot be negative.");
  if (draft.categories.filter((c) => c.is_primary).length > 1)
    throw new Error("Only one category can be primary.");
  if (draft.media.filter((m) => m.is_primary).length > 1)
    throw new Error("Only one image can be primary.");

  const skus = draft.variants
    .map((v) => v.sku?.trim().toLowerCase())
    .filter((s): s is string => !!s);
  if (new Set(skus).size !== skus.length)
    throw new Error("Variant SKUs must be unique within the product.");

  if (draft.product_type === "variable" && draft.variants.length === 0)
    throw new Error("Variable products need at least one variant.");
  if (draft.variants.some((v) => !v.title.trim()))
    throw new Error("Every variant needs a title.");
  if (draft.variants.some((v) => v.media.filter((m) => m.is_primary).length > 1))
    throw new Error("Each variant can only have one primary image.");

  const rels = draft.relationships.map((r) => `${r.relationship_type}:${r.related_product_id}`);
  if (new Set(rels).size !== rels.length)
    throw new Error("Duplicate product relationships are not allowed.");

  if (draft.product_type === "bundle") {
    const targets = draft.bundle_items.map((b) => b.variant_id ?? b.product_id);
    if (new Set(targets).size !== targets.length)
      throw new Error("Duplicate bundle contents are not allowed.");
    if (draft.bundle_items.some((b) => b.quantity < 1))
      throw new Error("Bundle quantities must be at least 1.");
  }
}

export interface SaveProductResult {
  productId: string;
  /** Variants removed in the editor that were archived because they have history. */
  archivedVariants: number;
  deletedVariants: number;
  /** Storage paths no longer referenced by any media row. */
  removedMedia: string[];
}

/**
 * Saves a product and every child record atomically.
 *
 * The payload is handed to `save_product_catalog`, which validates first and
 * then applies product, categories, variants, media, relationships and bundle
 * contents inside a single transaction. Variant identity is preserved: a
 * variant that already exists is UPDATED (its id, stock, ledger, orders and
 * purchasing history stay attached), a variant removed in the editor is
 * ARCHIVED when it has history and only physically deleted when it has never
 * been used.
 *
 * Storage objects for media rows that disappeared are removed afterwards
 * (compensating step — storage is not transactional). A failure there leaves
 * an unreferenced file, never a broken record.
 */
export async function saveProductCatalog(
  draft: ProductDraft,
  id?: string,
): Promise<SaveProductResult> {
  validate(draft);

  const payload = {
    name: draft.name.trim(),
    slug: toSlug(draft.slug || draft.name),
    sku: draft.sku?.trim() || null,
    barcode: draft.barcode?.trim() || null,
    short_description: draft.short_description?.trim() || null,
    description: draft.description?.trim() || null,
    brand_id: draft.brand_id,
    product_type: draft.product_type,
    supply_model: draft.supply_model,
    status: draft.status,
    visibility: draft.visibility,
    featured: draft.featured,
    // Only ACTIVE products may be purchasable (mirrors the DB trigger).
    is_purchasable: draft.status === "active" ? draft.is_purchasable : false,
    price: draft.price,
    compare_at_price: draft.compare_at_price,
    base_cost: draft.base_cost,
    additional_cost: draft.additional_cost,
    weight: draft.weight,
    weight_unit: draft.weight_unit,
    length: draft.length,
    width: draft.width,
    height: draft.height,
    dimension_unit: draft.dimension_unit,
    requires_shipping: draft.requires_shipping,
    categories: draft.categories.map((c) => ({
      category_id: c.category_id,
      is_primary: c.is_primary,
    })),
    media: draft.media.map((m) => ({
      key: m.key,
      url: m.url,
      alt_text: m.alt_text,
      is_primary: m.is_primary,
    })),
    variants: draft.variants.map((v) => ({
      key: v.key,
      title: v.title.trim(),
      sku: v.sku?.trim() || null,
      barcode: v.barcode?.trim() || null,
      price: v.price,
      compare_at_price: v.compare_at_price,
      base_cost: v.base_cost,
      additional_cost: v.additional_cost,
      weight: v.weight,
      length: v.length,
      width: v.width,
      height: v.height,
      status: v.status,
      media: v.media.map((m) => ({
        key: m.key,
        url: m.url,
        alt_text: m.alt_text,
        is_primary: m.is_primary,
      })),
    })),
    relationships: draft.relationships.map((r) => ({
      related_product_id: r.related_product_id,
      relationship_type: r.relationship_type,
    })),
    bundle_items: draft.bundle_items.map((b) => ({
      product_id: b.product_id,
      variant_id: b.variant_id,
      quantity: b.quantity,
    })),
  };

  const { data, error } = await supabase.rpc("save_product_catalog", {
    _product_id: id ?? null,
    _payload: payload as never,
  });
  if (error) throw new Error(friendlySaveError(error.message));

  const result = (data ?? {}) as {
    product_id: string;
    archived_variants?: number;
    deleted_variants?: number;
    removed_media?: string[];
  };

  const removedMedia = (result.removed_media ?? []).filter(
    (path) => !!path && !/^https?:\/\//.test(path),
  );
  // Compensating cleanup: only paths that no record references any more.
  await Promise.all(removedMedia.map((path) => removeCommerceMedia(path).catch(() => undefined)));

  return {
    productId: result.product_id,
    archivedVariants: result.archived_variants ?? 0,
    deletedVariants: result.deleted_variants ?? 0,
    removedMedia,
  };
}

/** Keeps raw Postgres noise out of the UI. */
function friendlySaveError(message: string): string {
  if (/duplicate key|unique constraint/i.test(message))
    return "Something in this product is already used by another record. Check the web address, product code and variant codes.";
  if (/violates foreign key/i.test(message))
    return "One of the selected records no longer exists. Reload the page and try again.";
  if (/permission denied|not permitted|permission to manage/i.test(message))
    return "You do not have permission to manage products.";
  return message;
}

/** Back-compatible wrapper: returns the product id. */
export async function saveProduct(draft: ProductDraft, id?: string): Promise<string> {
  return (await saveProductCatalog(draft, id)).productId;
}

/* ---------- Status operations ---------- */

export async function setProductsStatus(ids: string[], status: ProductStatus): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("products").update({ status }).in("id", ids);
  if (error) throw error;
}

export async function setProductsVisibility(
  ids: string[],
  visibility: "visible" | "hidden",
): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("products").update({ visibility }).in("id", ids);
  if (error) throw error;
}

export const archiveProducts = (ids: string[]) => setProductsStatus(ids, "archived");
/** Restored products come back as inactive — never straight to public. */
export const restoreProduct = (id: string) => setProductsStatus([id], "inactive");

/**
 * Price shown in lists.
 * Variable products use the lowest VALID variant price ("from ৳X"). When no
 * variant is priced this returns null — the parent price is deliberately NOT
 * used as a transactional fallback (Step 4.2). Callers render an unpriced state.
 */
export function displayPrice(row: ProductListRow): number | null {
  if (row.product_type === "variable") return variantFromPrice(row.product_variants);
  return row.price ?? null;
}

/** Variants of a variable product that cannot be sold because they have no price. */
export function unpricedVariantCount(variants: { price: number | null }[]): number {
  return variants.filter((v) => v.price === null || v.price === undefined).length;
}

export function primaryMedia(media: { url: string; is_primary: boolean }[]): string | null {
  if (!media?.length) return null;
  return (media.find((m) => m.is_primary) ?? media[0])?.url ?? null;
}

/**
 * Storefront image resolution: a variant shows its own images when it has any,
 * otherwise it falls back to the parent product images.
 */
export function resolveVariantMedia<T extends { is_primary: boolean }>(
  variantMedia: T[],
  productMedia: T[],
): T[] {
  return variantMedia.length ? variantMedia : productMedia;
}
