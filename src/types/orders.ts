import type { Database } from "@/integrations/supabase/types";
import type { ProductType } from "./commerce";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* ---------- Row types ---------- */

export type Order = Tables["orders"]["Row"];
export type OrderAddress = Tables["order_addresses"]["Row"];
export type OrderItem = Tables["order_items"]["Row"];
export type OrderNote = Tables["order_notes"]["Row"];

/* ---------- Independent status dimensions ---------- */

export type OrderStatus = Enums["order_status"];
export type { VerificationStatus } from "./verification";
export type FulfillmentStatus = Enums["order_fulfillment_status"];
export type DeliveryStatus = Enums["order_delivery_status"];
export type FinancialStatus = Enums["order_financial_status"];
export type PaymentStatus = Enums["payment_status"];
export type PaymentMethod = Enums["payment_method"];
export type OrderSource = Enums["order_source"];
export type OrderNoteType = Enums["order_note_type"];

export const ORDER_STATUSES: OrderStatus[] = ["draft", "created", "cancelled"];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  created: "Created",
  cancelled: "Cancelled",
};

export { VERIFICATION_STATUS_LABELS } from "./verification";


export type { ReservationStatus } from "./fulfillment";
export {
  FULFILLMENT_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
} from "./fulfillment";


export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  not_shipped: "Not shipped",
};

export const FINANCIAL_STATUS_LABELS: Record<FinancialStatus, string> = {
  not_applicable: "Not applicable",
};

export const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "partial", "paid", "refunded"];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Partially paid",
  paid: "Paid",
  refunded: "Refunded",
};

export const PAYMENT_METHODS: PaymentMethod[] = [
  "cod",
  "cash",
  "bkash",
  "nagad",
  "rocket",
  "card",
  "bank_transfer",
  "other",
];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cod: "Cash on delivery",
  cash: "Cash",
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  admin: "Admin",
  web: "Website",
  mobile: "Mobile app",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  phone: "Phone",
  import: "Import",
  api: "API",
};

export const NOTE_TYPE_LABELS: Record<OrderNoteType, string> = {
  general: "Note",
  system: "System",
};

/* ---------- Editing rules ---------- */

/** Draft = fully editable. Created = limited (no item/total changes). Cancelled = locked. */
export function canEditItems(status: OrderStatus): boolean {
  return status === "draft";
}
export function canCancel(status: OrderStatus): boolean {
  return status === "draft" || status === "created";
}
export function orderEditingRule(status: OrderStatus): string {
  switch (status) {
    case "draft":
      return "Draft — items, charges and totals can still be changed.";
    case "created":
      return "Created — items and totals are locked. Notes and payment can still be recorded.";
    case "cancelled":
      return "Cancelled — this order is kept as a historical record and cannot be edited.";
  }
}

/* ---------- Composed read shapes ---------- */

export interface OrderWithDetails extends Order {
  address: OrderAddress | null;
  items: OrderItem[];
  notes: (OrderNote & { author: { id: string; full_name: string | null } | null })[];
}

export interface OrderListRow extends Order {
  item_count: { count: number }[];
}

/* ---------- Draft (client side, pre-save) ---------- */

export interface DraftOrderItem {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  productType: ProductType;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  discountAmount: number;
}

export interface OrderChargesInput {
  orderDiscount: number;
  shippingCharge: number;
  adjustment: number;
  paidAmount: number;
  /** internal operational cost — never customer facing */
  deliveryCharge: number;
  packingCharge: number;
}

export interface OrderTotals {
  subtotal: number;
  productDiscount: number;
  orderDiscount: number;
  shippingCharge: number;
  adjustment: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  internalCost: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The single authoritative client-side preview of the order maths.
 * It mirrors the database exactly (`create_order` recomputes everything from
 * the products table, and grand_total / due_amount are generated columns), so
 * this is display only — never the source of truth for persisted money.
 */
export function calculateOrderTotals(
  items: Pick<DraftOrderItem, "quantity" | "unitPrice" | "discountAmount">[],
  charges: OrderChargesInput,
): OrderTotals {
  const subtotal = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const productDiscount = round2(items.reduce((sum, i) => sum + i.discountAmount, 0));
  const grandTotal = round2(
    subtotal - productDiscount - charges.orderDiscount + charges.shippingCharge + charges.adjustment,
  );
  return {
    subtotal,
    productDiscount,
    orderDiscount: round2(charges.orderDiscount),
    shippingCharge: round2(charges.shippingCharge),
    adjustment: round2(charges.adjustment),
    grandTotal,
    paidAmount: round2(charges.paidAmount),
    dueAmount: round2(grandTotal - charges.paidAmount),
    internalCost: round2(charges.deliveryCharge + charges.packingCharge),
  };
}

export function lineTotal(item: Pick<DraftOrderItem, "quantity" | "unitPrice" | "discountAmount">) {
  return round2(item.quantity * item.unitPrice - item.discountAmount);
}
