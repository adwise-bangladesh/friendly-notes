import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ProductType } from "@/types/commerce";
import type {
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

/* ---------- Bangladesh phone helpers (deliberately light) ---------- */

export function normalisePhone(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

/** Accepts 01XXXXXXXXX, +8801XXXXXXXXX and 8801XXXXXXXXX. */
export function isPlausibleBdPhone(value: string): boolean {
  const p = normalisePhone(value);
  return /^(?:\+?880|0)1[3-9]\d{8}$/.test(p);
}
