import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* Shared enums */
export type EntityStatus = Enums["entity_status"]; // active | inactive | archived
export type EntityVisibility = Enums["entity_visibility"]; // visible | hidden

/* Categories */
export type CategoryStatus = EntityStatus;
export type CategoryVisibility = EntityVisibility;
export type Category = Tables["categories"]["Row"];
export type CategoryInsert = Tables["categories"]["Insert"];
export type CategoryUpdate = Tables["categories"]["Update"];

/* Brands */
export type BrandType = Enums["brand_type"];
export type BrandStatus = EntityStatus;
export type BrandVisibility = EntityVisibility;
export type Brand = Tables["brands"]["Row"];
export type BrandInsert = Tables["brands"]["Insert"];
export type BrandUpdate = Tables["brands"]["Update"];

/* Products */
export type ProductType = Enums["product_type"];
export type SupplyModel = Enums["supply_model"];
export type ProductStatus = Enums["product_status"];
export type ProductVisibility = EntityVisibility;
export type Product = Tables["products"]["Row"];
export type ProductInsert = Tables["products"]["Insert"];
export type ProductUpdate = Tables["products"]["Update"];

/* Relationship + child tables */
export type ProductCategory = Tables["product_categories"]["Row"];
export type ProductVariant = Tables["product_variants"]["Row"];
export type VariantStatus = Enums["variant_status"];
export type ProductRelationship = Tables["product_relationships"]["Row"];
export type ProductRelationshipType = Enums["product_relationship_type"];
export type ProductMedia = Tables["product_media"]["Row"];

/* Composed read shapes used by the data access helpers */
export interface ProductWithRelations extends Product {
  brand: Brand | null;
  product_categories: (ProductCategory & { category: Category | null })[];
  product_variants: ProductVariant[];
  product_media: ProductMedia[];
}

/* Display labels */
export const ENTITY_STATUS_LABELS: Record<EntityStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const VISIBILITY_LABELS: Record<EntityVisibility, string> = {
  visible: "Visible",
  hidden: "Hidden",
};

export const BRAND_TYPE_LABELS: Record<BrandType, string> = {
  standard: "Standard",
  own_brand: "Own Brand",
  generic: "Generic",
};

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  simple: "Simple",
  variable: "Variable",
  bundle: "Bundle",
  service: "Service",
  digital: "Digital",
};

export const SUPPLY_MODEL_LABELS: Record<SupplyModel, string> = {
  in_stock: "In Stock",
  local_sourcing: "Local Sourcing",
  preorder: "Preorder",
  group_buy: "Group Buy",
};

export const SUPPLY_MODELS: SupplyModel[] = [
  "in_stock",
  "local_sourcing",
  "preorder",
  "group_buy",
];


export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const RELATIONSHIP_TYPE_LABELS: Record<ProductRelationshipType, string> = {
  related: "Related",
  upsell: "Upsell",
  cross_sell: "Cross-sell",
};


/* ---------- Product list + editor read shapes (Step 4) ---------- */

export interface ProductListRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  product_type: ProductType;
  supply_model: SupplyModel;
  status: ProductStatus;
  visibility: EntityVisibility;
  featured: boolean;
  is_purchasable: boolean;
  price: number;
  compare_at_price: number | null;
  updated_at: string;
  brand: { id: string; name: string } | null;
  product_categories: { is_primary: boolean; category: { id: string; name: string } | null }[];
  product_media: { url: string; is_primary: boolean; sort_order: number }[];
  product_variants: { id: string; price: number | null; sku: string | null }[];
}

export interface ProductRelationshipWithProduct extends ProductRelationship {
  related_product: {
    id: string;
    name: string;
    slug: string;
    status: ProductStatus;
    product_media: { url: string; is_primary: boolean }[];
  } | null;
}

export interface VariantWithMedia extends ProductVariant {
  product_media: ProductMedia[];
}

export interface BundleItemWithTarget extends BundleItem {
  product: { id: string; name: string; product_media: { url: string; is_primary: boolean }[] } | null;
  variant: {
    id: string;
    title: string;
    product: { id: string; name: string } | null;
    product_media: { url: string; is_primary: boolean }[];
  } | null;
}

export interface ProductEditorRecord extends Product {
  product_categories: ProductCategory[];
  product_variants: VariantWithMedia[];
  product_media: ProductMedia[];
  product_relationships: ProductRelationshipWithProduct[];
  bundle_items: BundleItemWithTarget[];
}

export interface ProductPickerOption {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  product_type: ProductType;
  product_media: { url: string; is_primary: boolean }[];
  product_variants: { id: string; title: string }[];
}

/* Draft shape used by the product editor form */
export interface ProductCategoryDraft {
  category_id: string;
  is_primary: boolean;
}

export interface ProductMediaDraft {
  key: string;
  url: string;
  alt_text: string | null;
  is_primary: boolean;
}

export interface ProductVariantDraft {
  key: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  compare_at_price: number | null;
  status: VariantStatus;
  /** Optional cost overrides — null means "inherit the product cost". */
  base_cost: number | null;
  additional_cost: number | null;
  /** Optional physical overrides — null means "inherit the product value". */
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  media: ProductMediaDraft[];
}

export interface ProductRelationshipDraft {
  key: string;
  related_product_id: string;
  relationship_type: ProductRelationshipType;
  name: string;
  thumbnail: string | null;
}

export interface BundleItemDraft {
  key: string;
  product_id: string | null;
  variant_id: string | null;
  quantity: number;
  /** Display only */
  name: string;
  variant_title: string | null;
  thumbnail: string | null;
}

export interface ProductDraft {
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  short_description: string | null;
  description: string | null;
  brand_id: string | null;
  product_type: ProductType;
  supply_model: SupplyModel;
  status: ProductStatus;
  visibility: EntityVisibility;
  featured: boolean;
  is_purchasable: boolean;
  price: number;
  compare_at_price: number | null;
  base_cost: number;
  additional_cost: number;
  weight: number | null;
  weight_unit: WeightUnit;
  length: number | null;
  width: number | null;
  height: number | null;
  dimension_unit: DimensionUnit;
  requires_shipping: boolean;
  categories: ProductCategoryDraft[];
  media: ProductMediaDraft[];
  variants: ProductVariantDraft[];
  relationships: ProductRelationshipDraft[];
  bundle_items: BundleItemDraft[];
}


export const PRODUCT_TYPE_HELP: Record<ProductType, string> = {
  simple: "Standard single product with one price. Example: a T-shirt.",
  variable: "Multiple purchasable options, each with its own SKU and price. Example: T-shirt in Black / M.",
  bundle: "Several products sold together as one item. Example: a skin care bundle.",
  service: "Non-physical service. Example: a website consultation.",
  digital: "Digital product delivered as a file or licence. Example: an ebook.",
};

export const SUPPLY_MODEL_HELP: Record<SupplyModel, string> = {
  in_stock: "Fulfilled from managed inventory held in your own stock.",
  local_sourcing: "Sourced locally after the order is received or confirmed. No stock required.",
  preorder: "Obtained after the customer orders. May need extra fulfilment time.",
  group_buy:
    "Orders are collected during a campaign window, then procured in bulk and delivered around a planned date.",
};

/* ---------- Step 4.1: costs, physical data, group buy, bundles ---------- */

export type GroupBuyStatus = Enums["group_buy_status"];
export type GroupBuyCampaign = Tables["group_buy_campaigns"]["Row"];
export type BundleItem = Tables["bundle_items"]["Row"];

export const GROUP_BUY_STATUS_LABELS: Record<GroupBuyStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  active: "Active",
  closed: "Closed",
  target_met: "Target Met",
  target_not_met: "Target Not Met",
  procurement: "Procurement",
  fulfillment: "Fulfillment",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const GROUP_BUY_STATUSES: GroupBuyStatus[] = [
  "draft",
  "scheduled",
  "active",
  "closed",
  "target_met",
  "target_not_met",
  "procurement",
  "fulfillment",
  "completed",
  "cancelled",
];

export const WEIGHT_UNITS = ["kg", "g", "lb"] as const;
export const DIMENSION_UNITS = ["cm", "m", "in"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

/** Product types that are shipped by default. */
export const SHIPPABLE_TYPES: ProductType[] = ["simple", "variable", "bundle"];
export const defaultRequiresShipping = (t: ProductType) => SHIPPABLE_TYPES.includes(t);

/* Cost maths — kept in one place so UI and future reports agree. */
export interface CostBreakdown {
  base: number;
  additional: number;
  landed: number;
}

export function landedCost(base: number | null, additional: number | null): number {
  return (base ?? 0) + (additional ?? 0);
}

/** Variant costs fall back to the parent product when not overridden. */
export function effectiveCost(
  variant: { base_cost: number | null; additional_cost: number | null },
  product: { base_cost: number; additional_cost: number },
): CostBreakdown & { overridden: boolean } {
  const overridden = variant.base_cost !== null || variant.additional_cost !== null;
  const base = overridden ? (variant.base_cost ?? 0) : product.base_cost;
  const additional = overridden ? (variant.additional_cost ?? 0) : product.additional_cost;
  return { base, additional, landed: base + additional, overridden };
}

export interface MarginResult {
  margin: number;
  percentage: number | null;
}

/** Estimated product margin — NOT actual profit (excludes courier, fees, ads, returns). */
export function estimatedMargin(sellingPrice: number, landed: number): MarginResult {
  const margin = sellingPrice - landed;
  return { margin, percentage: sellingPrice > 0 ? (margin / sellingPrice) * 100 : null };
}

/**
 * Fields that must never reach a customer-facing surface. Kept explicit so a
 * future storefront/mobile API can project public columns only.
 */
export const INTERNAL_PRODUCT_FIELDS = [
  "base_cost",
  "additional_cost",
  "estimated_landed_cost",
] as const;

/** Shape a future public API may safely expose. */
export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  is_purchasable: boolean;
  product_type: ProductType;
  supply_model: SupplyModel;
}

