import { supabase } from "@/integrations/supabase/client";
import type {
  Fulfillment,
  FulfillmentEvent,
  FulfillmentItemLine,
  FulfillmentRecordAction,
  FulfillmentRecordStatus,
  FulfillmentWithItems,
  OrderItemFulfillmentSummary,
  QCStatus,
  ShortageReason,
} from "@/types/fulfillment-records";
import { ACTIVE_FULFILLMENT_STATUSES } from "@/types/fulfillment-records";

/**
 * Warehouse fulfillment data access.
 *
 * Reads use explicit projections and only ever show the immutable order item
 * snapshot (product name, variant, sku, ordered quantity) as the authoritative
 * record; current product media is loaded separately for operational help.
 *
 * Every write goes through a SECURITY DEFINER database function
 * (`create_order_fulfillment`, `record_fulfillment_picks`,
 * `set_fulfillment_item_qc`, `set_fulfillment_state`). Direct client writes to
 * the fulfillment tables are rejected by database triggers and there is no
 * insert/update/delete policy on any of them.
 */

const ORDER_ITEM_SNAPSHOT =
  "id, product_id, variant_id, product_name, variant_name, sku, quantity, sort_order";

const FULFILLMENT_COLUMNS = `
  id, order_id, fulfillment_number, status, location_id, hold_reason, notes,
  started_at, picked_at, packed_at, ready_for_handover_at, cancelled_at,
  created_by, updated_by, created_at, updated_at
`;

const ITEM_COLUMNS = `
  id, fulfillment_id, order_item_id, quantity, picked_quantity, packed_quantity,
  shortage_reason, qc_status, qc_note, created_at, updated_at
`;

/* ---------- Product media (operational display only) ---------- */

async function primaryMedia(
  productIds: string[],
  variantIds: string[],
): Promise<Map<string, string>> {
  const media = new Map<string, string>();
  if (productIds.length === 0 && variantIds.length === 0) return media;
  const { data } = await supabase
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
  for (const m of data ?? []) {
    const key = m.variant_id ? `v:${m.variant_id}` : `p:${m.product_id}`;
    if (!media.has(key)) media.set(key, m.url);
  }
  return media;
}

interface RawItem {
  id: string;
  fulfillment_id: string;
  order_item_id: string;
  quantity: number;
  picked_quantity: number;
  packed_quantity: number;
  shortage_reason: ShortageReason | null;
  qc_status: QCStatus;
  qc_note: string | null;
  created_at: string;
  updated_at: string;
  order_item: {
    id: string;
    product_id: string | null;
    variant_id: string | null;
    product_name: string;
    variant_name: string | null;
    sku: string | null;
    quantity: number;
    sort_order: number;
  } | null;
}

async function decorateItems(rows: RawItem[]): Promise<FulfillmentItemLine[]> {
  const productIds = [
    ...new Set(rows.map((r) => r.order_item?.product_id).filter(Boolean)),
  ] as string[];
  const variantIds = [
    ...new Set(rows.map((r) => r.order_item?.variant_id).filter(Boolean)),
  ] as string[];
  const media = await primaryMedia(productIds, variantIds);

  return rows
    .map((r) => {
      const snapshot = r.order_item;
      const { order_item: _ignored, ...item } = r;
      return {
        ...item,
        orderItemId: r.order_item_id,
        productName: snapshot?.product_name ?? "Removed item",
        variantName: snapshot?.variant_name ?? null,
        sku: snapshot?.sku ?? null,
        orderedQuantity: snapshot?.quantity ?? r.quantity,
        imageUrl:
          (snapshot?.variant_id ? media.get(`v:${snapshot.variant_id}`) : undefined) ??
          (snapshot?.product_id ? media.get(`p:${snapshot.product_id}`) : undefined) ??
          null,
        _sort: snapshot?.sort_order ?? 0,
      };
    })
    .sort((a, b) => a._sort - b._sort)
    .map(({ _sort: _drop, ...line }) => line as FulfillmentItemLine);
}

/* ---------- Order context ---------- */

export async function getOrderFulfillments(orderId: string): Promise<FulfillmentWithItems[]> {
  const { data, error } = await supabase
    .from("order_fulfillments")
    .select(
      `${FULFILLMENT_COLUMNS},
       location:inventory_locations(id, name, code),
       items:order_fulfillment_items(${ITEM_COLUMNS}, order_item:order_items(${ORDER_ITEM_SNAPSHOT}))`,
    )
    .eq("order_id", orderId)
    .order("fulfillment_number", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as (Fulfillment & {
    location: FulfillmentWithItems["location"];
    items: RawItem[];
  })[];

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      order: null,
      items: await decorateItems(row.items ?? []),
    })),
  );
}

/** Ordered / fulfilled / remaining per order item, calculated in the database. */
export async function getOrderFulfillmentSummary(
  orderId: string,
): Promise<Map<string, OrderItemFulfillmentSummary>> {
  const { data, error } = await supabase.rpc("order_fulfillment_summary", { _order_id: orderId });
  if (error) throw error;
  const map = new Map<string, OrderItemFulfillmentSummary>();
  for (const row of data ?? []) {
    map.set(row.order_item_id, {
      orderItemId: row.order_item_id,
      ordered: row.ordered,
      fulfilled: row.fulfilled,
      remaining: row.remaining,
    });
  }
  return map;
}

/* ---------- Workspace ---------- */

export async function getFulfillmentById(id: string): Promise<FulfillmentWithItems | null> {
  const { data, error } = await supabase
    .from("order_fulfillments")
    .select(
      `${FULFILLMENT_COLUMNS},
       location:inventory_locations(id, name, code),
       order:orders(id, order_number, status, customer_name, customer_phone, verification_status),
       items:order_fulfillment_items(${ITEM_COLUMNS}, order_item:order_items(${ORDER_ITEM_SNAPSHOT}))`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as Fulfillment & {
    location: FulfillmentWithItems["location"];
    order: FulfillmentWithItems["order"];
    items: RawItem[];
  };
  return { ...row, items: await decorateItems(row.items ?? []) };
}

export async function getFulfillmentEvents(fulfillmentId: string): Promise<FulfillmentEvent[]> {
  const { data, error } = await supabase
    .from("order_fulfillment_events")
    .select("id, fulfillment_id, order_id, event_type, from_status, to_status, message, metadata, created_by, created_at")
    .eq("fulfillment_id", fulfillmentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FulfillmentEvent[];
}

/** Every fulfillment event of an order — used by the combined order timeline. */
export async function getOrderFulfillmentEvents(orderId: string): Promise<
  (FulfillmentEvent & { fulfillment: { fulfillment_number: number } | null })[]
> {
  const { data, error } = await supabase
    .from("order_fulfillment_events")
    .select(
      "id, fulfillment_id, order_id, event_type, from_status, to_status, message, metadata, created_by, created_at, fulfillment:order_fulfillments(fulfillment_number)",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as (FulfillmentEvent & {
    fulfillment: { fulfillment_number: number } | null;
  })[];
}

/* ---------- Queue ---------- */

export interface FulfillmentQueueRecord extends Fulfillment {
  location: { id: string; name: string; code: string } | null;
  order: {
    id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    status: string;
  } | null;
  items: {
    quantity: number;
    picked_quantity: number;
    packed_quantity: number;
  }[];
}

export interface FulfillmentQueueQuery {
  search?: string;
  status?: FulfillmentRecordStatus | "all" | "active";
  locationId?: string | "all";
  from?: string;
  to?: string;
  limit?: number;
}

export async function getFulfillmentRecordQueue(
  filters: FulfillmentQueueQuery = {},
): Promise<FulfillmentQueueRecord[]> {
  let query = supabase
    .from("order_fulfillments")
    .select(
      `${FULFILLMENT_COLUMNS},
       location:inventory_locations(id, name, code),
       order:orders!inner(id, order_number, customer_name, customer_phone, status),
       items:order_fulfillment_items(quantity, picked_quantity, packed_quantity)`,
    )
    .order("created_at", { ascending: true })
    .limit(filters.limit ?? 200);

  if (filters.status && filters.status !== "all") {
    if (filters.status === "active") {
      query = query.in("status", ACTIVE_FULFILLMENT_STATUSES);
    } else {
      query = query.eq("status", filters.status);
    }
  }
  if (filters.locationId && filters.locationId !== "all") {
    query = query.eq("location_id", filters.locationId);
  }
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const term = filters.search?.trim();
  if (term) {
    const like = `%${term}%`;
    const asNumber = Number.parseInt(term, 10);
    if (Number.isFinite(asNumber) && String(asNumber) === term) {
      query = query.eq("fulfillment_number", asNumber);
    } else {
      query = query.or(
        `order_number.ilike.${like},customer_name.ilike.${like},customer_phone.ilike.${like}`,
        { referencedTable: "orders" },
      );
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as FulfillmentQueueRecord[];
}

/** Live warehouse counters for the dashboard. */
export async function getFulfillmentStatusCounts(): Promise<
  Partial<Record<FulfillmentRecordStatus, number>>
> {
  const { data, error } = await supabase
    .from("order_fulfillments")
    .select("status")
    .in("status", ACTIVE_FULFILLMENT_STATUSES);
  if (error) throw error;
  const counts: Partial<Record<FulfillmentRecordStatus, number>> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

/* ---------- Controlled operations ---------- */

export interface CreateFulfillmentInput {
  orderId: string;
  locationId: string;
  items: { orderItemId: string; quantity: number }[];
  notes?: string | null;
}

export async function createOrderFulfillment(input: CreateFulfillmentInput): Promise<Fulfillment> {
  const notes = input.notes?.trim();
  const { data, error } = await supabase.rpc("create_order_fulfillment", {
    _order_id: input.orderId,
    _location_id: input.locationId,
    _items: input.items.map((i) => ({ order_item_id: i.orderItemId, quantity: i.quantity })),
    ...(notes ? { _notes: notes } : {}),
  });
  if (error) throw error;
  return data as unknown as Fulfillment;
}

export async function recordFulfillmentPicks(
  fulfillmentId: string,
  items: { itemId: string; pickedQuantity: number; shortageReason?: ShortageReason | null }[],
): Promise<Fulfillment> {
  const { data, error } = await supabase.rpc("record_fulfillment_picks", {
    _fulfillment_id: fulfillmentId,
    _items: items.map((i) => ({
      item_id: i.itemId,
      picked_quantity: i.pickedQuantity,
      shortage_reason: i.shortageReason ?? null,
    })),
  });
  if (error) throw error;
  return data as unknown as Fulfillment;
}

export async function setFulfillmentItemQc(
  itemId: string,
  qcStatus: QCStatus,
  note?: string | null,
): Promise<Fulfillment> {
  const clean = note?.trim();
  const { data, error } = await supabase.rpc("set_fulfillment_item_qc", {
    _item_id: itemId,
    _qc_status: qcStatus,
    ...(clean ? { _note: clean } : {}),
  });
  if (error) throw error;
  return data as unknown as Fulfillment;
}

export async function setFulfillmentRecordState(args: {
  fulfillmentId: string;
  action: FulfillmentRecordAction;
  reason?: string | null;
}): Promise<Fulfillment> {
  const reason = args.reason?.trim();
  const { data, error } = await supabase.rpc("set_fulfillment_state", {
    _fulfillment_id: args.fulfillmentId,
    _action: args.action,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as Fulfillment;
}

