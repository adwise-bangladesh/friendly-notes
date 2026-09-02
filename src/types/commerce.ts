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
};

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
  bundle_item: "Bundle Item",
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
  price: number;
  compare_at_price: number | null;
  updated_at: string;
  brand: { id: string; name: string } | null;
  product_categories: { is_primary: boolean; category: { id: string; name: string } | null }[];
  product_media: { url: string; is_primary: boolean; sort_order: number }[];
  product_variants: { id: string; price: number | null }[];
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

export interface ProductEditorRecord extends Product {
  product_categories: ProductCategory[];
  product_variants: ProductVariant[];
  product_media: ProductMedia[];
  product_relationships: ProductRelationshipWithProduct[];
}

export interface ProductPickerOption {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  product_media: { url: string; is_primary: boolean }[];
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
}

export interface ProductRelationshipDraft {
  key: string;
  related_product_id: string;
  relationship_type: ProductRelationshipType;
  name: string;
  thumbnail: string | null;
}

export interface ProductDraft {
  name: string;
  slug: string;
  sku: string | null;
  short_description: string | null;
  description: string | null;
  brand_id: string | null;
  product_type: ProductType;
  supply_model: SupplyModel;
  status: ProductStatus;
  visibility: EntityVisibility;
  featured: boolean;
  price: number;
  compare_at_price: number | null;
  categories: ProductCategoryDraft[];
  media: ProductMediaDraft[];
  variants: ProductVariantDraft[];
  relationships: ProductRelationshipDraft[];
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
};
