import type { Database } from "@/integrations/supabase/types";
import type { EntityStatus, ProductStatus, ProductType, SupplyModel } from "./commerce";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type InventoryLocation = Tables["inventory_locations"]["Row"];
export type InventoryLocationInsert = Tables["inventory_locations"]["Insert"];
export type InventoryLocationUpdate = Tables["inventory_locations"]["Update"];

export type InventoryLevel = Tables["inventory_levels"]["Row"];
export type InventoryMovement = Tables["inventory_movements"]["Row"];
export type InventoryMovementType = Enums["inventory_movement_type"];

export type InventoryLocationStatus = EntityStatus;

/** Movement types an operator may pick manually. `fulfillment_out` is system only. */
export const MOVEMENT_TYPES: InventoryMovementType[] = [
  "initial",
  "adjustment_in",
  "adjustment_out",
  "damage",
  "return_in",
  "reservation",
  "release_reservation",
];

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  initial: "Initial Stock",
  adjustment_in: "Adjustment In",
  adjustment_out: "Adjustment Out",
  damage: "Damage / Loss",
  return_in: "Return In",
  reservation: "Reservation",
  release_reservation: "Release Reservation",
  fulfillment_out: "Fulfilled / Packed Out",
  purchase_in: "Purchase Received",
  purchase_damaged_in: "Purchase Damaged",
  damaged_out: "Damaged Removed",
  transfer_out: "Transfer Out",
  transfer_in: "Transfer In",
  transfer_incoming_in: "Transfer In Transit",
  transfer_incoming_out: "Transfer Arrived",
  stocktake_in: "Stocktake Increase",
  stocktake_out: "Stocktake Decrease",
};

export const MOVEMENT_TYPE_HELP: Record<InventoryMovementType, string> = {
  initial: "First stock count for this item at this location.",
  adjustment_in: "Stock added — a delivery, a correction upwards, or found stock.",
  adjustment_out: "Stock removed — a correction downwards, shrinkage, or an internal use.",
  damage: "Stock removed from on hand and recorded as damaged.",
  return_in: "Stock returned by a customer and put back on the shelf.",
  reservation: "Holds stock for an order. Reduces available, not on hand.",
  release_reservation: "Frees previously reserved stock back to available.",
  fulfillment_out: "Packed for a customer order — reserved stock leaves on hand permanently.",
  purchase_in: "Accepted goods from a supplier delivery. Created by finalising a goods receipt.",
  purchase_damaged_in:
    "Goods that arrived damaged from a supplier. Recorded as damaged, never as sellable stock.",
  damaged_out:
    "Damaged stock removed — written off, returned to the supplier, or a reversed damage record.",
  transfer_out: "Stock dispatched from this location to another location.",
  transfer_in: "Stock received at this location from a transfer.",
  transfer_incoming_in: "Stock in transit towards this location. Not sellable yet.",
  transfer_incoming_out: "In-transit stock arrived and left the incoming pool.",
  stocktake_in: "Physical count was higher than the system. Corrected upwards.",
  stocktake_out: "Physical count was lower than the system. Corrected downwards.",
};

/** Movements that increase on hand. */
export const INBOUND_MOVEMENTS: InventoryMovementType[] = [
  "initial",
  "adjustment_in",
  "return_in",
  "purchase_in",
  "transfer_in",
  "stocktake_in",
];

export function movementDirection(type: InventoryMovementType): "in" | "out" | "hold" {
  if (INBOUND_MOVEMENTS.includes(type)) return "in";
  if (type === "purchase_damaged_in") return "hold";
  if (type === "reservation") return "hold";
  if (type === "release_reservation") return "hold";
  if (type === "transfer_incoming_in" || type === "transfer_incoming_out") return "hold";
  return "out";
}

/* ---------- Tracking eligibility (mirrors the database trigger) ---------- */

/**
 * Only a simple product tracks stock on the product itself.
 * A variable product tracks stock per variant, never on the parent.
 * Bundle, service and digital products are not stock tracked at all.
 */
export function productTracksInventory(productType: ProductType): boolean {
  return productType === "simple";
}

export function productTracksInventoryViaVariants(productType: ProductType): boolean {
  return productType === "variable";
}

export function inventoryTrackingReason(productType: ProductType): string {
  switch (productType) {
    case "simple":
      return "Stock is tracked on this product.";
    case "variable":
      return "Stock is tracked separately for each variant.";
    case "bundle":
      return "Bundles are not stock tracked. Availability comes from the products inside the bundle.";
    case "service":
      return "Services have no physical stock.";
    case "digital":
      return "Digital products have no physical stock.";
  }
}

/* ---------- Composed read shapes ---------- */

export interface InventoryLevelRow extends InventoryLevel {
  location: Pick<InventoryLocation, "id" | "name" | "code" | "status"> | null;
  product: {
    id: string;
    name: string;
    sku: string | null;
    product_type: ProductType;
    supply_model: SupplyModel;
    status: ProductStatus;
  } | null;
  variant: {
    id: string;
    title: string;
    sku: string | null;
    product: {
      id: string;
      name: string;
      product_type: ProductType;
      supply_model: SupplyModel;
      status: ProductStatus;
    } | null;
  } | null;
}

export interface InventoryMovementRow extends InventoryMovement {
  actor: { id: string; full_name: string | null } | null;
}

/** Flattened row used by the inventory table UI. */
export interface InventoryItem {
  levelId: string;
  productId: string;
  variantId: string | null;
  itemName: string;
  variantTitle: string | null;
  sku: string | null;
  productType: ProductType;
  supplyModel: SupplyModel;
  productStatus: ProductStatus;
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  damaged: number;
  incoming: number;
  available: number;
  lowStockThreshold: number | null;
  updatedAt: string;
}

export type StockState = "out_of_stock" | "low_stock" | "in_stock";

export function stockState(item: {
  available: number;
  lowStockThreshold: number | null;
}): StockState {
  if (item.available <= 0) return "out_of_stock";
  if (item.lowStockThreshold !== null && item.available <= item.lowStockThreshold) {
    return "low_stock";
  }
  return "in_stock";
}

export const STOCK_STATE_LABELS: Record<StockState, string> = {
  out_of_stock: "Out of stock",
  low_stock: "Low stock",
  in_stock: "In stock",
};

export function toInventoryItem(row: InventoryLevelRow): InventoryItem {
  const parent = row.variant?.product ?? row.product;
  return {
    levelId: row.id,
    productId: parent?.id ?? "",
    variantId: row.variant?.id ?? null,
    itemName: parent?.name ?? "Unknown item",
    variantTitle: row.variant?.title ?? null,
    sku: row.variant?.sku ?? row.product?.sku ?? null,
    productType: parent?.product_type ?? "simple",
    supplyModel: parent?.supply_model ?? "in_stock",
    productStatus: parent?.status ?? "draft",
    locationId: row.location_id,
    locationName: row.location?.name ?? "Unknown location",
    onHand: row.on_hand,
    reserved: row.reserved,
    damaged: row.damaged,
    incoming: row.incoming,
    available: row.available_quantity ?? row.on_hand - row.reserved,
    lowStockThreshold: row.low_stock_threshold,
    updatedAt: row.updated_at,
  };
}

/* ---------- Step 8: adjustments, transfers, stocktakes ---------- */

export type InventoryAdjustmentReason = Enums["inventory_adjustment_reason"];
export type InventoryTransferStatus = Enums["inventory_transfer_status"];
export type StocktakeStatus = Enums["stocktake_status"];

export type InventoryTransfer = Tables["inventory_transfers"]["Row"];
export type InventoryTransferItem = Tables["inventory_transfer_items"]["Row"];
export type Stocktake = Tables["stocktakes"]["Row"];
export type StocktakeItem = Tables["stocktake_items"]["Row"];

/** Movement types an operator may record by hand. Everything else is system generated. */
export const MANUAL_MOVEMENT_TYPES = [
  "initial",
  "adjustment_in",
  "adjustment_out",
  "damage",
  "return_in",
  "damaged_out",
] as const satisfies readonly InventoryMovementType[];

export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

/** `damaged_out` writes off damaged stock and is restricted to administrators. */
export const ADMIN_ONLY_MOVEMENT_TYPES: InventoryMovementType[] = ["damaged_out"];

export const ADJUSTMENT_REASONS: InventoryAdjustmentReason[] = [
  "stock_found",
  "stock_missing",
  "counting_error",
  "damage",
  "correction",
  "other",
];

export const ADJUSTMENT_REASON_LABELS: Record<InventoryAdjustmentReason, string> = {
  stock_found: "Stock found",
  stock_missing: "Stock missing",
  counting_error: "Counting error",
  damage: "Damage",
  correction: "Correction",
  other: "Other (explain in the note)",
};

export const TRANSFER_STATUS_LABELS: Record<InventoryTransferStatus, string> = {
  draft: "Draft",
  pending: "Pending dispatch",
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

export const TRANSFER_STATUS_TONE: Record<
  InventoryTransferStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  draft: "neutral",
  pending: "warning",
  in_transit: "info",
  received: "success",
  cancelled: "danger",
};

export const STOCKTAKE_STATUS_LABELS: Record<StocktakeStatus, string> = {
  draft: "Draft",
  in_progress: "Counting",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STOCKTAKE_STATUS_TONE: Record<
  StocktakeStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  draft: "neutral",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};

export interface TransferItemInput {
  productId: string | null;
  variantId: string | null;
  requestedQuantity: number;
}

export interface TransferWithLocations extends InventoryTransfer {
  from_location: Pick<InventoryLocation, "id" | "name" | "code"> | null;
  to_location: Pick<InventoryLocation, "id" | "name" | "code"> | null;
  item_count?: number;
}

export interface StocktakeWithLocation extends Stocktake {
  location: Pick<InventoryLocation, "id" | "name" | "code"> | null;
}

/** Rows shown in the global movement ledger. */
export interface MovementLedgerRow extends InventoryMovement {
  itemName: string;
  variantTitle: string | null;
  sku: string | null;
  locationName: string;
  actorName: string | null;
}
