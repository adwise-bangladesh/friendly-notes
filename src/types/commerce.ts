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
