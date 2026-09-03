import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ProductType } from "@/types/commerce";
import type {
  DeliveryStatus,
  Order,
  OrderListRow,
  OrderNote,
  OrderStatus,
  OrderWithDetails,
  PaymentMethod,
  PaymentStatus,
} from "@/types/orders";

/**
 * Order data access.
 *
 * Orders are never assembled from the client in multiple steps: creation goes
 * through `create_order`, which validates every item against the products
 * table, recomputes all money server-side and writes the order, its address,
 * its items and its first system note inside one transaction.
 *
 * None of the selects below expose internal product cost columns
 * (base_cost / additional_cost / estimated_landed_cost).
 */

const ORDER_LIST_SELECT = `
  id, order_number, source, customer_name, customer_phone, customer_email,
  status, verification_status, fulfillment_status, delivery_status, financial_status,
  payment_method, payment_status,
  subtotal, product_discount, order_discount, shipping_charge, adjustment,
  grand_total, paid_amount, due_amount, delivery_charge, packing_charge,
  placed_at, cancelled_at, created_at, updated_at, created_by, updated_by,
  item_count:order_items(count)
`;

const ORDER_DETAIL_SELECT = `
  *,
  address:order_addresses(*),
  items:order_items(*),
  notes:order_notes(*)
`;

export interface OrderListFilters {
  search?: string;
  status?: OrderStatus | "all";
  /** Derived order-level delivery projection (see refresh_order_delivery_status). */
  deliveryStatus?: DeliveryStatus | "all";
  paymentStatus?: PaymentStatus | "all";
  from?: string;
  to?: string;
  limit?: number;
}

export async function getOrders(filters: OrderListFilters = {}): Promise<OrderListRow[]> {
  let query = supabase
    .from("orders")
    .select(ORDER_LIST_SELECT)
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.deliveryStatus && filters.deliveryStatus !== "all") {
    query = query.eq("delivery_status", filters.deliveryStatus);
  }
  if (filters.paymentStatus && filters.paymentStatus !== "all") {
    query = query.eq("payment_status", filters.paymentStatus);
  }
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const term = filters.search?.trim();
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      `order_number.ilike.${like},customer_name.ilike.${like},customer_phone.ilike.${like},customer_email.ilike.${like}`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as OrderListRow[];
}

export async function getOrderById(id: string): Promise<OrderWithDetails | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as OrderWithDetails & { address: unknown };
  const address = Array.isArray(row.address) ? (row.address[0] ?? null) : row.address;

  // order_notes.created_by references auth.users, so the author name is
  // resolved with a second read against profiles rather than an embed.
  const authorIds = [...new Set((row.notes ?? []).map((n) => n.created_by).filter(Boolean))] as string[];
  const authors = new Map<string, { id: string; full_name: string | null }>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const p of profiles ?? []) authors.set(p.id, p);
  }

  return {
    ...row,
    address: address as OrderWithDetails["address"],
    items: [...(row.items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    notes: [...(row.notes ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((n) => ({ ...n, author: n.created_by ? (authors.get(n.created_by) ?? null) : null })),
  };
}

/* ---------- Product search for the order builder ---------- */

export interface OrderProductVariantOption {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  compare_at_price: number | null;
  status: string;
}

export interface OrderProductOption {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  compare_at_price: number | null;
  product_type: ProductType;
  is_purchasable: boolean;
  product_variants: OrderProductVariantOption[];
}

/** Explicit, cost-free projection used by the order product picker. */
const ORDER_PRODUCT_SELECT = `
  id, name, sku, barcode, price, compare_at_price, product_type, is_purchasable,
  product_variants(id, title, sku, barcode, price, compare_at_price, status)
`;

export async function searchOrderProducts(term: string, limit = 20): Promise<OrderProductOption[]> {
  let query = supabase
    .from("products")
    .select(ORDER_PRODUCT_SELECT)
    .eq("status", "active")
    .eq("is_purchasable", true)
    .order("name")
    .limit(limit);

  const search = term.trim();
  if (search) {
    const like = `%${search}%`;
    query = query.or(`name.ilike.${like},sku.ilike.${like},barcode.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as OrderProductOption[];
}

/* ---------- Creation ---------- */

export interface CreateOrderInput {
  source?: "admin";
  status?: Extract<OrderStatus, "draft" | "created">;
  /** Reuse an existing customer identity. Omitted = resolve/create by phone. */
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address: {
    recipientName?: string;
    phone?: string;
    addressLine: string;
    area?: string;
    district?: string;
    division?: string;
    postalCode?: string;
    country?: string;
  };
  items: {
    productId: string;
    variantId: string | null;
    quantity: number;
    discountAmount: number;
  }[];
  paymentMethod: PaymentMethod;
  orderDiscount: number;
  shippingCharge: number;
  adjustment: number;
  paidAmount: number;
  deliveryCharge: number;
  packingCharge: number;
  note?: string;
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const payload = {
    source: input.source ?? "admin",
    status: input.status ?? "created",
    customer_id: input.customerId ?? null,
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    customer_email: input.customerEmail ?? null,
    address: {
      recipient_name: input.address.recipientName ?? input.customerName,
      phone: input.address.phone ?? input.customerPhone,
      address_line: input.address.addressLine,
      area: input.address.area ?? null,
      district: input.address.district ?? null,
      division: input.address.division ?? null,
      postal_code: input.address.postalCode ?? null,
      country: input.address.country ?? "Bangladesh",
    },
    items: input.items.map((i) => ({
      product_id: i.productId,
      variant_id: i.variantId,
      quantity: i.quantity,
      discount_amount: i.discountAmount,
    })),
    payment_method: input.paymentMethod,
    order_discount: input.orderDiscount,
    shipping_charge: input.shippingCharge,
    adjustment: input.adjustment,
    paid_amount: input.paidAmount,
    delivery_charge: input.deliveryCharge,
    packing_charge: input.packingCharge,
    note: input.note ?? null,
  };

  const { data, error } = await supabase.rpc("create_order", {
    _payload: payload as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as Order;
}

/**
 * Cancels an order. After the warehouse has packed it, stock has already left
 * on hand — the database then requires `force` (owner/admin only) and never
 * silently puts the stock back.
 */
export async function cancelOrder(
  orderId: string,
  reason?: string,
  force = false,
): Promise<Order> {
  const { data, error } = await supabase.rpc("cancel_order", {
    _order_id: orderId,
    _force: force,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as Order;
}


export async function addOrderNote(orderId: string, note: string): Promise<OrderNote> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("order_notes")
    .insert({
      order_id: orderId,
      note,
      note_type: "general",
      is_internal: true,
      created_by: auth.user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/* ---------- Bangladesh phone helpers ---------- */

/**
 * Client-side mirror of the database canonicaliser (`canonical_contact_phone`).
 * The database remains authoritative — this only gives the operator instant
 * feedback in the form.
 */
export function normalisePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

/** Accepts 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX, 008801XXXXXXXXX. */
export function isPlausibleBdPhone(value: string): boolean {
  const p = normalisePhone(value);
  if (/^\+/.test(p) && !/^\+880/.test(p)) {
    // legitimate international numbers stay allowed
    return /^\+\d{8,15}$/.test(p);
  }
  const digits = p.replace(/\D/g, "");
  const local =
    digits.length === 11 && digits.startsWith("01")
      ? digits
      : digits.length === 13 && digits.startsWith("8801")
        ? digits.slice(2)
        : digits.length === 15 && digits.startsWith("008801")
          ? digits.slice(4)
          : digits.length === 10 && digits.startsWith("1")
            ? `0${digits}`
            : digits;
  return /^01[3-9]\d{8}$/.test(local);
}


/* ---------- Controlled order corrections (Step 20.1 fix) ---------- */

/**
 * Orders are immutable after creation except through these explicit controlled
 * corrections. Both are rejected by the database once the order is
 * operationally locked — that is, once stock has been committed at courier
 * handover or a shipment has left the draft stage. Item, price and money
 * editing does not exist: a wrong order is cancelled and re-created.
 */
export async function isOrderOperationallyLocked(orderId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("order_operationally_locked", { _order_id: orderId });
  if (error) throw error;
  return Boolean(data);
}

/**
 * Corrects the customer identity on an order.
 *
 * The database refuses to point an order at a blocked customer and requires a
 * reason whenever the correction moves the order to a different customer
 * record — a typo fix on the same customer needs no reason.
 */
export async function updateOrderCustomer(args: {
  orderId: string;
  name: string;
  phone: string;
  email?: string | null;
  reason?: string | null;
}): Promise<Order> {
  const { data, error } = await supabase.rpc("update_order_customer", {
    _order_id: args.orderId,
    _customer_name: args.name,
    _customer_phone: args.phone,
    ...(args.email ? { _customer_email: args.email } : {}),
    ...(args.reason ? { _reason: args.reason } : {}),
  });
  if (error) throw error;
  return data as unknown as Order;
}

export interface OrderAddressInput {
  recipient_name: string;
  phone: string;
  address_line: string;
  area?: string | null;
  district?: string | null;
  division?: string | null;
  postal_code?: string | null;
}

export async function updateOrderAddress(orderId: string, address: OrderAddressInput): Promise<void> {
  const { error } = await supabase.rpc("update_order_address", {
    _order_id: orderId,
    _address: address as unknown as Json,
  });
  if (error) throw error;
}

/* ---------- Controlled pre-operation item editing (Step 20.8.1) ---------- */

/**
 * Returns a plain-English reason why the order's items can no longer be
 * edited, or null when a controlled edit is still allowed. The same check runs
 * again inside `update_order_items`, so this is UX only.
 */
export async function getOrderEditBlockReason(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("order_edit_block_reason", { _order_id: orderId });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export interface OrderItemEditInput {
  /** Existing order_items row — omitted for a newly added line. */
  id?: string | null;
  productId: string;
  variantId: string | null;
  quantity: number;
  discountAmount: number;
  /** Authorised price correction. Omitted keeps the existing snapshot price. */
  unitPrice?: number | null;
}

export interface UpdateOrderItemsInput {
  orderId: string;
  items: OrderItemEditInput[];
  orderDiscount?: number;
  shippingCharge?: number;
  adjustment?: number;
  reason?: string | null;
}

/**
 * The only way to change what an order contains after creation. Every total is
 * recalculated by the database, reservations are released and rebuilt, and an
 * append-only system note records the change.
 */
export async function updateOrderItems(input: UpdateOrderItemsInput): Promise<Order> {
  const payload: Record<string, unknown> = {
    items: input.items.map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      product_id: i.productId,
      variant_id: i.variantId,
      quantity: i.quantity,
      discount_amount: i.discountAmount,
      ...(typeof i.unitPrice === "number" ? { unit_price: i.unitPrice } : {}),
    })),
  };
  if (typeof input.orderDiscount === "number") payload["order_discount"] = input.orderDiscount;
  if (typeof input.shippingCharge === "number") payload["shipping_charge"] = input.shippingCharge;
  if (typeof input.adjustment === "number") payload["adjustment"] = input.adjustment;
  if (input.reason?.trim()) payload["reason"] = input.reason.trim();

  const { data, error } = await supabase.rpc("update_order_items", {
    _order_id: input.orderId,
    _payload: payload as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as Order;
}

/* ---------- Customer intelligence for order surfaces ---------- */

export interface OrderCustomerIntelligence {
  linked: boolean;
  customer: { id: string; name: string; primary_phone: string; status: string } | null;
  metrics: Record<string, number | string | boolean | null> | null;
  flags: { flag: string; reason: string | null; created_at: string }[];
  recent_orders: {
    id: string;
    order_number: string;
    status: OrderStatus;
    delivery_status: DeliveryStatus;
    verification_status: string;
    grand_total: number;
    created_at: string;
  }[];
}

/**
 * Operational history for the customer behind an order: previous orders,
 * delivery/return behaviour and any active manual flags. Permission checked in
 * the database; carries no internal cost data.
 */
export async function getOrderCustomerIntelligence(
  orderId: string,
): Promise<OrderCustomerIntelligence> {
  const { data, error } = await supabase.rpc("order_customer_intelligence", {
    _order_id: orderId,
  });
  if (error) throw error;
  return data as unknown as OrderCustomerIntelligence;
}
