import { supabase } from "@/integrations/supabase/client";
import { toSlug } from "./commerce";
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

async function syncChildren(productId: string, draft: ProductDraft) {
  // Categories
  await supabase.from("product_categories").delete().eq("product_id", productId);
  if (draft.categories.length) {
    const { error } = await supabase.from("product_categories").insert(
      draft.categories.map((c, i) => ({
        product_id: productId,
        category_id: c.category_id,
        is_primary: c.is_primary,
        sort_order: i,
      })),
    );
    if (error) throw error;
  }

  // Variants (deleting a variant cascades its variant-level media)
  await supabase.from("product_variants").delete().eq("product_id", productId);

  // Product-level media
  await supabase.from("product_media").delete().eq("product_id", productId);
  if (draft.media.length) {
    const { error } = await supabase.from("product_media").insert(
      draft.media.map((m, i) => ({
        product_id: productId,
        url: m.url,
        alt_text: m.alt_text,
        is_primary: m.is_primary,
        sort_order: i,
      })),
    );
    if (error) throw error;
  }

  if (draft.product_type === "variable" && draft.variants.length) {
    const { data: inserted, error } = await supabase
      .from("product_variants")
      .insert(
        draft.variants.map((v, i) => ({
          product_id: productId,
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
          sort_order: i,
        })),
      )
      .select("id, sort_order");
    if (error) throw error;

    // Variant-specific media, matched back by sort_order.
    const byOrder = new Map((inserted ?? []).map((r) => [r.sort_order, r.id]));
    const variantMedia = draft.variants.flatMap((v, i) => {
      const variantId = byOrder.get(i);
      if (!variantId) return [];
      return v.media.map((m, j) => ({
        variant_id: variantId,
        product_id: null,
        url: m.url,
        alt_text: m.alt_text,
        is_primary: m.is_primary,
        sort_order: j,
      }));
    });
    if (variantMedia.length) {
      const { error: mErr } = await supabase.from("product_media").insert(variantMedia);
      if (mErr) throw mErr;
    }
  }

  // Relationships (outgoing only)
  await supabase.from("product_relationships").delete().eq("product_id", productId);
  if (draft.relationships.length) {
    const { error } = await supabase.from("product_relationships").insert(
      draft.relationships.map((r, i) => ({
        product_id: productId,
        related_product_id: r.related_product_id,
        relationship_type: r.relationship_type,
        sort_order: i,
      })),
    );
    if (error) throw error;
  }

  // Bundle contents
  await supabase.from("bundle_items").delete().eq("bundle_product_id", productId);
  if (draft.product_type === "bundle" && draft.bundle_items.length) {
    const { error } = await supabase.from("bundle_items").insert(
      draft.bundle_items.map((b, i) => ({
        bundle_product_id: productId,
        product_id: b.variant_id ? null : b.product_id,
        variant_id: b.variant_id,
        quantity: b.quantity,
        sort_order: i,
      })),
    );
    if (error) throw error;
  }
}

export async function saveProduct(draft: ProductDraft, id?: string): Promise<string> {
  validate(draft);

  const slug = toSlug(draft.slug || draft.name);
  if (!(await isProductSlugAvailable(slug, id)))
    throw new Error(`The slug "${slug}" is already in use.`);

  const sku = draft.sku?.trim() || null;
  if (sku && !(await isProductSkuAvailable(sku, id)))
    throw new Error(`The SKU "${sku}" is already used by another product.`);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  const base = {
    name: draft.name.trim(),
    slug,
    sku,
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
    updated_by: userId,
  };

  let productId = id;
  if (productId) {
    const { error } = await supabase.from("products").update(base).eq("id", productId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("products")
      .insert({ ...base, created_by: userId })
      .select("id")
      .single();
    if (error) throw error;
    productId = data.id;
  }

  await syncChildren(productId, draft);
  return productId;
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
