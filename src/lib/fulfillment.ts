import { supabase } from "@/integrations/supabase/client";
import type { Order, OrderSource } from "@/types/orders";
import type {
  FulfillmentStatus,
  InventoryReservation,
  PickListLine,
  ReservationStatus,
} from "@/types/fulfillment";
import { FULFILLMENT_QUEUE_STATUSES } from "@/types/fulfillment";

/**
 * Fulfillment data access.
 *
 * Reads use explicit projections (never internal product cost columns).
 * Every write goes through a SECURITY DEFINER database function:
 * `reserve_order_inventory`, `release_order_reservations` and
 * `set_order_fulfillment_state` (which commits stock when an order is packed).
 * Direct client writes to reservation or fulfillment columns are rejected by
 * database triggers, and `inventory_reservations` has no write policy at all.
 */

/* ---------- Queue ---------- */

const QUEUE_SELECT = `
  id, order_number, source, customer_name, customer_phone, status, created_at,
  verification_status, reservation_status, fulfillment_status,
  fulfillment_hold_reason, fulfillment_location_id, reserved_at, packed_at,
  item_count:order_items(count),
  location:inventory_locations(id, name, code)
`;

export interface FulfillmentQueueRow {
  id: string;
  order_number: string;
  source: OrderSource;
  customer_name: string;
  customer_phone: string;
  status: string;
  created_at: string;
  verification_status: string;
  reservation_status: ReservationStatus;
  fulfillment_status: FulfillmentStatus;
  fulfillment_hold_reason: string | null;
  fulfillment_location_id: string | null;
  reserved_at: string | null;
  packed_at: string | null;
  item_count: { count: number }[];
  location: { id: string; name: string; code: string } | null;
}

export interface FulfillmentQueueFilters {
  search?: string;
  status?: FulfillmentStatus | "all";
  reservation?: ReservationStatus | "all";
  locationId?: string | "all";
  limit?: number;
}

export async function getFulfillmentQueue(
  filters: FulfillmentQueueFilters = {},
): Promise<FulfillmentQueueRow[]> {
  let query = supabase
    .from("orders")
    .select(QUEUE_SELECT)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })
    .limit(filters.limit ?? 200);

  if (filters.status && filters.status !== "all") {
    query = query.eq("fulfillment_status", filters.status);
  } else {
    query = query.in("fulfillment_status", FULFILLMENT_QUEUE_STATUSES);
  }
  if (filters.reservation && filters.reservation !== "all") {
    query = query.eq("reservation_status", filters.reservation);
  }
  if (filters.locationId && filters.locationId !== "all") {
    query = query.eq("fulfillment_location_id", filters.locationId);
  }

  const term = filters.search?.trim();
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      `order_number.ilike.${like},customer_name.ilike.${like},customer_phone.ilike.${like}`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as FulfillmentQueueRow[];
}

/** Small counter set used by the dashboard attention panel. */
export async function getFulfillmentSummary(): Promise<Record<FulfillmentStatus | "on_hold", number>> {
  const { data, error } = await supabase
    .from("orders")
    .select("fulfillment_status")
    .neq("status", "cancelled")
    .in("fulfillment_status", FULFILLMENT_QUEUE_STATUSES);
  if (error) throw error;
  const counts = {} as Record<FulfillmentStatus | "on_hold", number>;
  for (const row of data ?? []) {
    const key = row.fulfillment_status as FulfillmentStatus;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/* ---------- Reservations ---------- */

const RESERVATION_SELECT = `
  id, order_id, order_item_id, inventory_level_id, location_id,
  product_id, variant_id, quantity, status,
  created_at, updated_at, released_at, committed_at,
  created_by, released_by, committed_by
`;

export async function getOrderReservations(orderId: string): Promise<InventoryReservation[]> {
  const { data, error } = await supabase
    .from("inventory_reservations")
    .select(RESERVATION_SELECT)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InventoryReservation[];
}

/** Active reservations touching one stock record — shown on the inventory page. */
export async function getLevelReservations(levelId: string): Promise<
  (InventoryReservation & { order: { id: string; order_number: string } | null })[]
> {
  const { data, error } = await supabase
    .from("inventory_reservations")
    .select(`${RESERVATION_SELECT}, order:orders(id, order_number)`)
    .eq("inventory_level_id", levelId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as (InventoryReservation & {
    order: { id: string; order_number: string } | null;
  })[];
}

/* ---------- Pick list ---------- */

export async function getPickList(orderId: string): Promise<PickListLine[]> {
  const [itemsRes, reservationsRes] = await Promise.all([
    supabase
      .from("order_items")
      .select("id, product_id, variant_id, product_name, variant_name, sku, product_type, quantity, sort_order")
      .eq("order_id", orderId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("inventory_reservations")
      .select("order_item_id, quantity, status, location:inventory_locations(name)")
      .eq("order_id", orderId)
      .in("status", ["active", "committed"]),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (reservationsRes.error) throw reservationsRes.error;

  const items = itemsRes.data ?? [];
  const reservations = (reservationsRes.data ?? []) as unknown as {
    order_item_id: string;
    quantity: number;
    location: { name: string } | null;
  }[];
  const byItem = new Map(reservations.map((r) => [r.order_item_id, r]));

  // Primary image per product (variant image preferred when present).
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))] as string[];
  const variantIds = [...new Set(items.map((i) => i.variant_id).filter(Boolean))] as string[];
  const media = new Map<string, string>();
  if (productIds.length > 0 || variantIds.length > 0) {
    const { data: rows } = await supabase
      .from("product_media")
      .select("product_id, variant_id, url, is_primary, sort_order")
      .or(
        [
          productIds.length ? `product_id.in.(${productIds.join(",")})` : "",
          variantIds.length ? `variant_id.in.(${variantIds.join(",")})` : "",
        ]
          .filter(Boolean)
          .join(","),
      )
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true });
    for (const m of rows ?? []) {
      const key = m.variant_id ? `v:${m.variant_id}` : `p:${m.product_id}`;
      if (!media.has(key)) media.set(key, m.url);
    }
  }

  return items.map((i) => {
    const reservation = byItem.get(i.id);
    const stockTracked = i.product_type === "simple" || i.product_type === "variable";
    return {
      orderItemId: i.id,
      productName: i.product_name,
      variantName: i.variant_name,
      sku: i.sku,
      productType: i.product_type ?? "simple",
      imageUrl:
        (i.variant_id ? media.get(`v:${i.variant_id}`) : undefined) ??
        (i.product_id ? media.get(`p:${i.product_id}`) : undefined) ??
        null,
      requiredQuantity: i.quantity,
      reservedQuantity: reservation?.quantity ?? 0,
      locationName: reservation?.location?.name ?? null,
      stockTracked,
    } satisfies PickListLine;
  });
}

/* ---------- Controlled operations ---------- */

export async function reserveOrderInventory(orderId: string): Promise<Order> {
  const { data, error } = await supabase.rpc("reserve_order_inventory", { _order_id: orderId });
  if (error) throw error;
  return data as unknown as Order;
}

export async function releaseOrderReservations(orderId: string, reason: string): Promise<Order> {
  const { data, error } = await supabase.rpc("release_order_reservations", {
    _order_id: orderId,
    _reason: reason,
  });
  if (error) throw error;
  return data as unknown as Order;
}

export type FulfillmentStateAction =
  | "start_picking"
  | "mark_picked"
  | "start_packing"
  | "mark_packed"
  | "ready_for_courier"
  | "hold"
  | "resume";

export async function setFulfillmentState(args: {
  orderId: string;
  action: FulfillmentStateAction;
  reason?: string | null;
}): Promise<Order> {
  const { data, error } = await supabase.rpc("set_order_fulfillment_state", {
    _order_id: args.orderId,
    _action: args.action,
    ...(args.reason ? { _reason: args.reason } : {}),
  });
  if (error) throw error;
  return data as unknown as Order;
}
