import { supabase } from "@/integrations/supabase/client";
import type {
  CourierAccount,
  CourierProvider,
  CourierProviderEvent,
  CourierServiceType,
  Shipment,
  ShipmentAction,
  ShipmentEvent,
  ShipmentFailureReason,
  ShipmentHoldReason,
  ShipmentItemLine,
  ShipmentQueueRow,
  ShipmentStatus,
  ShipmentWithDetails,
  ShippableLine,
} from "@/types/shipping";
import { ACTIVE_SHIPMENT_STATUSES } from "@/types/shipping";

/**
 * Courier & shipping data access.
 *
 * Shipments are an internal, provider-neutral record. The app never talks to a
 * courier API here: every status change is an operational entry recorded by
 * staff, and the internal shipment number is the identifier the business owns.
 *
 * All writes go through SECURITY DEFINER database functions
 * (`create_shipment`, `assign_shipment_courier`, `update_shipment_details`,
 * `set_shipment_state`). Direct client writes to shipment tables are rejected
 * by triggers and there are no insert/update/delete policies on them.
 */

const SHIPMENT_COLUMNS = `
  id, shipment_number, order_id, fulfillment_id, status, provider_id, service_type,
  tracking_number, external_consignment_id, provider_reference,
  recipient_name, recipient_phone, delivery_address, delivery_area, delivery_city,
  delivery_zone, postal_code,
  cash_on_delivery_amount, declared_value, weight, package_count,
  hold_reason, failure_reason, notes, internal_notes,
  booked_at, picked_up_at, delivered_at, cancelled_at,
  created_by, updated_by, created_at, updated_at,
  courier_account_id, provider_status, provider_status_slug, provider_status_at,
  last_synced_at, quoted_delivery_fee, booked_delivery_fee,
  return_tracking_number, return_reason, partial_delivery_note,
  provider_recipient_city_id, provider_recipient_zone_id, provider_recipient_area_id,
  booking_idempotency_key, booking_snapshot, booking_attempt_started_at,
  booking_attempt_count, booking_last_error, booking_outcome_unknown
`;

/* ---------- Courier providers ---------- */

export async function getCourierProviders(
  onlyActive = false,
): Promise<CourierProvider[]> {
  let query = supabase
    .from("courier_providers")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (onlyActive) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Courier accounts for a provider. Credentials live in a separate table with no
 * client grants at all, so nothing sensitive can be selected from the browser.
 */
export async function getCourierAccounts(providerId?: string): Promise<CourierAccount[]> {
  let query = supabase
    .from("courier_accounts")
    .select("id, provider_id, name, code, environment, external_store_id, base_url, status, is_default, settings, created_by, updated_by, created_at, updated_at")
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });
  if (providerId) query = query.eq("provider_id", providerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CourierAccount[];
}

/** Raw provider events for one shipment — the courier's own words, kept for audit. */
export async function getShipmentCourierEvents(
  shipmentId: string,
): Promise<CourierProviderEvent[]> {
  const { data, error } = await supabase
    .from("courier_provider_events")
    .select(
      "id, provider_id, account_id, shipment_id, source, fingerprint, provider_event, provider_status, consignment_id, merchant_order_id, provider_event_at, payload, processing_status, processing_note, received_at",
    )
    .eq("shipment_id", shipmentId)
    .order("received_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as CourierProviderEvent[];
}

/* ---------- Shippable quantities ---------- */

/** Planned / fulfilled / shipped / shippable per fulfillment line, from the database. */
export async function getFulfillmentShippableSummary(
  fulfillmentId: string,
): Promise<ShippableLine[]> {
  const { data, error } = await supabase.rpc("fulfillment_shippable_summary", {
    _fulfillment_id: fulfillmentId,
  });
  if (error) throw error;
  return (data ?? []) as ShippableLine[];
}

/* ---------- Reads ---------- */

interface RawShipmentItem {
  id: string;
  shipment_id: string;
  order_item_id: string;
  fulfillment_item_id: string | null;
  quantity: number;
  created_at: string;
  order_item: {
    product_name: string;
    variant_name: string | null;
    sku: string | null;
    sort_order: number;
  } | null;
}

function decorateItems(rows: RawShipmentItem[]): ShipmentItemLine[] {
  return rows
    .map((r) => {
      const { order_item: snapshot, ...item } = r;
      return {
        ...item,
        productName: snapshot?.product_name ?? "Removed item",
        variantName: snapshot?.variant_name ?? null,
        sku: snapshot?.sku ?? null,
        _sort: snapshot?.sort_order ?? 0,
      };
    })
    .sort((a, b) => a._sort - b._sort)
    .map(({ _sort: _drop, ...line }) => line as ShipmentItemLine);
}

export async function getShipmentById(id: string): Promise<ShipmentWithDetails | null> {
  const { data, error } = await supabase
    .from("shipments")
    .select(
      `${SHIPMENT_COLUMNS},
       provider:courier_providers(id, name, code, status),
       account:courier_accounts(id, name, code, environment),
       order:orders(id, order_number, status, customer_name, customer_phone, payment_method, grand_total, due_amount),
       fulfillment:order_fulfillments(id, fulfillment_number, status),
       items:shipment_items(id, shipment_id, order_item_id, fulfillment_item_id, quantity,
         delivered_quantity, refused_quantity, lost_quantity, damaged_quantity, created_at,
         order_item:order_items(product_name, variant_name, sku, sort_order))`,

    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as Omit<ShipmentWithDetails, "items"> & { items: RawShipmentItem[] };
  return { ...row, items: decorateItems(row.items ?? []) };
}

export async function getShipmentEvents(shipmentId: string): Promise<ShipmentEvent[]> {
  const { data, error } = await supabase
    .from("shipment_events")
    .select(
      "id, shipment_id, order_id, event_type, from_status, to_status, message, metadata, provider_event_id, created_by, created_at",
    )
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShipmentEvent[];
}

/** Every shipment of one order, newest last, for the order detail panel. */
export async function getOrderShipments(orderId: string): Promise<
  (Shipment & { provider: { id: string; name: string; code: string } | null })[]
> {
  const { data, error } = await supabase
    .from("shipments")
    .select(`${SHIPMENT_COLUMNS}, provider:courier_providers(id, name, code)`)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as (Shipment & {
    provider: { id: string; name: string; code: string } | null;
  })[];
}

export async function getFulfillmentShipments(fulfillmentId: string): Promise<
  (Shipment & { provider: { id: string; name: string; code: string } | null })[]
> {
  const { data, error } = await supabase
    .from("shipments")
    .select(`${SHIPMENT_COLUMNS}, provider:courier_providers(id, name, code)`)
    .eq("fulfillment_id", fulfillmentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as (Shipment & {
    provider: { id: string; name: string; code: string } | null;
  })[];
}

/* ---------- Queue ---------- */

export interface ShipmentQueueQuery {
  search?: string;
  status?: ShipmentStatus | "all" | "active";
  providerId?: string | "all" | "unassigned";
  from?: string;
  to?: string;
  limit?: number;
}

export async function getShipmentQueue(
  filters: ShipmentQueueQuery = {},
): Promise<ShipmentQueueRow[]> {
  let query = supabase
    .from("shipments")
    .select(
      `${SHIPMENT_COLUMNS},
       provider:courier_providers(id, name, code),
       order:orders!inner(id, order_number, customer_name, customer_phone)`,
    )
    .order("created_at", { ascending: true })
    .limit(filters.limit ?? 200);

  if (filters.status && filters.status !== "all") {
    if (filters.status === "active") query = query.in("status", ACTIVE_SHIPMENT_STATUSES);
    else query = query.eq("status", filters.status);
  }
  if (filters.providerId && filters.providerId !== "all") {
    query =
      filters.providerId === "unassigned"
        ? query.is("provider_id", null)
        : query.eq("provider_id", filters.providerId);
  }
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const term = filters.search?.trim();
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      `shipment_number.ilike.${like},tracking_number.ilike.${like},recipient_name.ilike.${like},recipient_phone.ilike.${like}`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ShipmentQueueRow[];
}

/** Live shipping-desk counters for the dashboard. */
export async function getShipmentStatusCounts(): Promise<
  Partial<Record<ShipmentStatus, number>>
> {
  const { data, error } = await supabase
    .from("shipments")
    .select("status")
    .in("status", ACTIVE_SHIPMENT_STATUSES);
  if (error) throw error;
  const counts: Partial<Record<ShipmentStatus, number>> = {};
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

/* ---------- Controlled operations ---------- */

export interface CreateShipmentInput {
  fulfillmentId: string;
  items?: { fulfillmentItemId: string; quantity: number }[];
  providerId?: string | null;
  serviceType?: CourierServiceType | null;
  cashOnDeliveryAmount?: number | null;
  declaredValue?: number | null;
  weight?: number | null;
  packageCount?: number | null;
  notes?: string | null;
  internalNotes?: string | null;
}

export async function createShipment(input: CreateShipmentInput): Promise<Shipment> {
  const notes = input.notes?.trim();
  const internal = input.internalNotes?.trim();
  const { data, error } = await supabase.rpc("create_shipment", {
    _fulfillment_id: input.fulfillmentId,
    ...(input.items
      ? {
          _items: input.items.map((i) => ({
            fulfillment_item_id: i.fulfillmentItemId,
            quantity: i.quantity,
          })),
        }
      : {}),
    ...(input.providerId ? { _provider_id: input.providerId } : {}),
    ...(input.serviceType ? { _service_type: input.serviceType } : {}),
    ...(input.cashOnDeliveryAmount != null
      ? { _cash_on_delivery_amount: input.cashOnDeliveryAmount }
      : {}),
    ...(input.declaredValue != null ? { _declared_value: input.declaredValue } : {}),
    ...(input.weight != null ? { _weight: input.weight } : {}),
    ...(input.packageCount != null ? { _package_count: input.packageCount } : {}),
    ...(notes ? { _notes: notes } : {}),
    ...(internal ? { _internal_notes: internal } : {}),
  });
  if (error) throw error;
  return data as unknown as Shipment;
}

export async function assignShipmentCourier(args: {
  shipmentId: string;
  providerId: string;
  serviceType?: CourierServiceType | null;
  accountId?: string | null;
}): Promise<Shipment> {
  const { data, error } = await supabase.rpc("assign_shipment_courier", {
    _shipment_id: args.shipmentId,
    _provider_id: args.providerId,
    ...(args.serviceType ? { _service_type: args.serviceType } : {}),
    ...(args.accountId ? { _account_id: args.accountId } : {}),
  });
  if (error) throw error;
  return data as unknown as Shipment;
}

export async function updateShipmentDetails(args: {
  shipmentId: string;
  cashOnDeliveryAmount?: number | null;
  declaredValue?: number | null;
  weight?: number | null;
  packageCount?: number | null;
  notes?: string | null;
  internalNotes?: string | null;
}): Promise<Shipment> {
  const { data, error } = await supabase.rpc("update_shipment_details", {
    _shipment_id: args.shipmentId,
    ...(args.cashOnDeliveryAmount != null
      ? { _cash_on_delivery_amount: args.cashOnDeliveryAmount }
      : {}),
    ...(args.declaredValue != null ? { _declared_value: args.declaredValue } : {}),
    ...(args.weight != null ? { _weight: args.weight } : {}),
    ...(args.packageCount != null ? { _package_count: args.packageCount } : {}),
    ...(args.notes != null ? { _notes: args.notes } : {}),
    ...(args.internalNotes != null ? { _internal_notes: args.internalNotes } : {}),
  });
  if (error) throw error;
  return data as unknown as Shipment;
}

export async function setShipmentState(args: {
  shipmentId: string;
  action: ShipmentAction;
  reason?: string | null;
  holdReason?: ShipmentHoldReason | null;
  failureReason?: ShipmentFailureReason | null;
  trackingNumber?: string | null;
  externalConsignmentId?: string | null;
}): Promise<Shipment> {
  const reason = args.reason?.trim();
  const tracking = args.trackingNumber?.trim();
  const consignment = args.externalConsignmentId?.trim();
  const { data, error } = await supabase.rpc("set_shipment_state", {
    _shipment_id: args.shipmentId,
    _action: args.action,
    ...(reason ? { _reason: reason } : {}),
    ...(args.holdReason ? { _hold_reason: args.holdReason } : {}),
    ...(args.failureReason ? { _failure_reason: args.failureReason } : {}),
    ...(tracking ? { _tracking_number: tracking } : {}),
    ...(consignment ? { _external_consignment_id: consignment } : {}),
  });
  if (error) throw error;
  return data as unknown as Shipment;
}

/** Records a courier return leg. Return tracking is separate from forward tracking. */
export async function setShipmentReturnTracking(args: {
  shipmentId: string;
  returnTrackingNumber?: string | null;
  returnReason?: string | null;
}): Promise<Shipment> {
  const tracking = args.returnTrackingNumber?.trim();
  const reason = args.returnReason?.trim();
  const { data, error } = await supabase.rpc("set_shipment_return_tracking", {
    _shipment_id: args.shipmentId,
    _return_tracking_number: tracking ?? "",
    ...(reason ? { _return_reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as Shipment;
}

/**
 * Resolves a booking whose outcome is unknown (the courier was contacted but
 * the answer was lost). `confirm` records the consignment the courier really
 * created; `abandon` proves no parcel exists and issues a fresh booking key so
 * a retry can never collide with the previous attempt.
 */
export async function resolveUnknownCourierBooking(args: {
  shipmentId: string;
  resolution: "confirm" | "abandon";
  consignmentId?: string | null;
  reason?: string | null;
}): Promise<Shipment> {
  const consignment = args.consignmentId?.trim();
  const reason = args.reason?.trim();
  const { data, error } = await supabase.rpc("resolve_unknown_courier_booking", {
    _shipment_id: args.shipmentId,
    _resolution: args.resolution,
    ...(consignment ? { _consignment_id: consignment } : {}),
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as Shipment;
}

/* ---------- Per-item delivery outcomes ---------- */

export interface DeliveryOutcomeLine {
  shipmentItemId: string;
  deliveredQuantity: number;
  refusedQuantity: number;
  lostQuantity: number;
  damagedQuantity: number;
}

/**
 * Records the authoritative quantity-level courier outcome for a shipment.
 *
 * Quantities are validated and applied inside `record_delivery_outcome`, which
 * locks the shipment, rejects totals above the shipped quantity, raises the
 * matching delivery exception and moves the shipment through the existing state
 * machine. Recording refused or damaged units never restocks inventory — that
 * still requires the physical return receipt and inspection workflow.
 */
export async function recordDeliveryOutcome(args: {
  shipmentId: string;
  lines: DeliveryOutcomeLine[];
  note?: string | null;
  finalize?: boolean;
}): Promise<Shipment> {
  const note = args.note?.trim();
  const { data, error } = await supabase.rpc("record_delivery_outcome", {
    _shipment_id: args.shipmentId,
    _items: args.lines.map((l) => ({
      shipment_item_id: l.shipmentItemId,
      delivered_quantity: l.deliveredQuantity,
      refused_quantity: l.refusedQuantity,
      lost_quantity: l.lostQuantity,
      damaged_quantity: l.damagedQuantity,
    })),
    ...(note ? { _note: note } : {}),
    _finalize: args.finalize ?? true,
  });
  if (error) throw error;
  return data as unknown as Shipment;
}

export interface ExpectedReturnLine {
  order_item_id: string;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  refused_quantity: number;
  damaged_quantity: number;
  suggested_quantity: number;
  returnable_quantity: number;
}

/** Units the courier says are coming back. Nothing is restocked by reading this. */
export async function getShipmentExpectedReturnItems(
  shipmentId: string,
): Promise<ExpectedReturnLine[]> {
  const { data, error } = await supabase.rpc("shipment_expected_return_items", {
    _shipment_id: shipmentId,
  });
  if (error) throw error;
  return (data ?? []) as ExpectedReturnLine[];
}
