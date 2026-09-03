import type { Database } from "@/integrations/supabase/types";
import type { StatusTone } from "@/components/shared/StatusBadge";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* ---------- Row types ---------- */

export type Supplier = Tables["suppliers"]["Row"];
export type SupplierInsert = Tables["suppliers"]["Insert"];
export type SupplierUpdate = Tables["suppliers"]["Update"];
export type SupplierContact = Tables["supplier_contacts"]["Row"];
export type SupplierContactInsert = Tables["supplier_contacts"]["Insert"];
export type SupplierProduct = Tables["supplier_products"]["Row"];
export type SupplierProductInsert = Tables["supplier_products"]["Insert"];

export type PurchaseOrder = Tables["purchase_orders"]["Row"];
export type PurchaseOrderItem = Tables["purchase_order_items"]["Row"];
export type PurchaseOrderEvent = Tables["purchase_order_events"]["Row"];
export type GoodsReceipt = Tables["goods_receipts"]["Row"];
export type GoodsReceiptItem = Tables["goods_receipt_items"]["Row"];
export type ProductCostHistory = Tables["product_cost_history"]["Row"];

/* ---------- Enums ---------- */

export type SupplierStatus = Enums["entity_status"];
export type PurchaseOrderStatus = Enums["purchase_order_status"];
export type GoodsReceiptStatus = Enums["goods_receipt_status"];
export type PurchaseOrderEventType = Enums["purchase_order_event_type"];
export type CostChangeSource = Enums["cost_change_source"];
export type ItemCostType = Enums["item_cost_type"];

export const SUPPLIER_STATUSES: SupplierStatus[] = ["active", "inactive", "archived"];
export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};
export const SUPPLIER_STATUS_TONE: Record<SupplierStatus, StatusTone> = {
  active: "success",
  inactive: "warning",
  archived: "neutral",
};

export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
  "closed",
];

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
  closed: "Closed",
};

export const PO_STATUS_TONE: Record<PurchaseOrderStatus, StatusTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  ordered: "info",
  partially_received: "warning",
  received: "success",
  cancelled: "danger",
  closed: "neutral",
};

export const PO_STATUS_MEANING: Record<PurchaseOrderStatus, string> = {
  draft: "Draft — every commercial detail can still be changed.",
  pending_approval: "Awaiting approval — an admin or owner must approve the commercial intent.",
  approved: "Approved — the commercial intent is authorised. Goods can be received.",
  ordered: "Ordered — committed to the supplier and waiting on delivery.",
  partially_received: "Partially received — some goods have arrived and entered inventory.",
  received: "Received — every ordered unit has been received.",
  cancelled: "Cancelled — procurement abandoned. Kept as a historical record.",
  closed: "Closed — administratively complete. No further receiving.",
};

export const RECEIPT_STATUS_LABELS: Record<GoodsReceiptStatus, string> = {
  draft: "Draft",
  received: "Received",
  cancelled: "Cancelled",
};
export const RECEIPT_STATUS_TONE: Record<GoodsReceiptStatus, StatusTone> = {
  draft: "warning",
  received: "success",
  cancelled: "neutral",
};

export const PO_EVENT_LABELS: Record<PurchaseOrderEventType, string> = {
  created: "Created",
  updated: "Updated",
  submitted_for_approval: "Submitted for approval",
  approval_returned: "Returned to draft",
  approved: "Approved",
  ordered: "Ordered",
  receipt_created: "Receipt created",
  receipt_cancelled: "Receipt cancelled",
  partially_received: "Partially received",
  received: "Received",
  receipt_reversed: "Receipt reversed",
  cancelled: "Cancelled",
  closed: "Closed",
  note_added: "Note",
};

export const COST_SOURCE_LABELS: Record<CostChangeSource, string> = {
  manual: "Manual",
  purchase_receipt: "Goods receipt",
  correction: "Correction",
};

export const COST_TYPE_LABELS: Record<ItemCostType, string> = {
  base_cost: "Base cost",
  additional_cost: "Additional cost",
};

/* ---------- Lifecycle rules (mirror set_purchase_order_status) ---------- */

export function canEditPurchaseOrder(status: PurchaseOrderStatus): boolean {
  return status === "draft" || status === "pending_approval";
}
export function canSubmitForApproval(status: PurchaseOrderStatus): boolean {
  return status === "draft";
}
export function canApprove(status: PurchaseOrderStatus): boolean {
  return status === "pending_approval";
}
export function canMarkOrdered(status: PurchaseOrderStatus): boolean {
  return status === "approved";
}
export function canReceiveGoods(status: PurchaseOrderStatus): boolean {
  return status === "approved" || status === "ordered" || status === "partially_received";
}
export function canClose(status: PurchaseOrderStatus): boolean {
  return status === "ordered" || status === "partially_received" || status === "received";
}
/** The database also rejects cancellation once any quantity has been received. */
export function canCancelPurchaseOrder(status: PurchaseOrderStatus, receivedTotal: number): boolean {
  return status !== "cancelled" && status !== "closed" && receivedTotal === 0;
}

/* ---------- Composed read shapes ---------- */

export interface SupplierListRow extends Supplier {
  productCount: number;
  purchaseOrderCount: number;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
}

export interface SupplierProductWithItem extends SupplierProduct {
  product: { id: string; name: string; sku: string | null } | null;
  variant: { id: string; title: string; sku: string | null; product: { id: string; name: string } | null } | null;
}

export interface PurchaseOrderListRow {
  id: string;
  purchase_order_number: string;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_delivery_date: string | null;
  currency: string;
  grand_total: number;
  created_at: string;
  supplier_name_snapshot: string | null;
  supplier_code_snapshot: string | null;
  supplier: { id: string; name: string; supplier_code: string } | null;
  item_count: { count: number }[];
}

export interface GoodsReceiptWithItems extends GoodsReceipt {
  items: GoodsReceiptItem[];
  location: { id: string; name: string; code: string } | null;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  supplier: Supplier | null;
  items: PurchaseOrderItem[];
  receipts: GoodsReceiptWithItems[];
  events: PurchaseOrderEvent[];
}

/* ---------- Draft (client side, pre-save) ---------- */

export interface DraftPurchaseOrderItem {
  key: string;
  productId: string | null;
  variantId: string | null;
  displayName: string;
  variantName: string | null;
  sku: string | null;
  quantityOrdered: number;
  unitCost: number;
  discountAmount: number;
  taxAmount: number;
}

export interface PurchaseOrderCharges {
  discountTotal: number;
  shippingCost: number;
  dutyCost: number;
  otherCost: number;
}

export interface PurchaseOrderTotals {
  subtotal: number;
  discountTotal: number;
  shippingCost: number;
  dutyCost: number;
  otherCost: number;
  grandTotal: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function poLineTotal(
  item: Pick<DraftPurchaseOrderItem, "quantityOrdered" | "unitCost" | "discountAmount" | "taxAmount">,
): number {
  return round2(item.quantityOrdered * item.unitCost - item.discountAmount + item.taxAmount);
}

/** Display-only preview. The database recomputes every stored total. */
export function calculatePurchaseOrderTotals(
  items: Pick<DraftPurchaseOrderItem, "quantityOrdered" | "unitCost" | "discountAmount" | "taxAmount">[],
  charges: PurchaseOrderCharges,
): PurchaseOrderTotals {
  const subtotal = round2(items.reduce((sum, i) => sum + poLineTotal(i), 0));
  return {
    subtotal,
    discountTotal: round2(charges.discountTotal),
    shippingCost: round2(charges.shippingCost),
    dutyCost: round2(charges.dutyCost),
    otherCost: round2(charges.otherCost),
    grandTotal: round2(
      subtotal - charges.discountTotal + charges.shippingCost + charges.dutyCost + charges.otherCost,
    ),
  };
}

/* ---------- Receiving helpers ---------- */

export interface ReceiveLineDraft {
  purchaseOrderItemId: string;
  received: number;
  damaged: number;
  notes: string;
}

export function acceptedQuantity(line: Pick<ReceiveLineDraft, "received" | "damaged">): number {
  return line.received - line.damaged;
}

export function receiveLineError(
  line: Pick<ReceiveLineDraft, "received" | "damaged">,
  remaining: number,
): string | null {
  if (line.received < 0 || line.damaged < 0) return "Quantities cannot be negative";
  if (line.damaged > line.received) return "Damaged cannot exceed received";
  if (line.received > remaining) return `Only ${remaining} remaining`;
  return null;
}

export function remainingQuantity(item: Pick<PurchaseOrderItem, "quantity_ordered" | "quantity_received">): number {
  return item.quantity_ordered - item.quantity_received;
}
