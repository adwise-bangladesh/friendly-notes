import { supabase } from "@/integrations/supabase/client";
import type {
  ExceptionAction,
  ExceptionQueueRow,
  OrderReturn,
  OrderReturnStatus,
  OrderReturnType,
  ReturnAction,
  ReturnItemCondition,
  ReturnQueueRow,
  ReturnWithDetails,
  ShipmentException,
  ShipmentExceptionStatus,
  ShipmentExceptionType,
} from "@/types/returns";
import { OPEN_EXCEPTION_STATUSES, OPEN_RETURN_STATUSES } from "@/types/returns";

/**
 * Delivery exceptions and returns data access.
 *
 * Reads go through RLS-protected selects; every write goes through a
 * SECURITY DEFINER function, because direct writes to these tables are
 * rejected by guard triggers.
 */

const ORDER_REF = "order:orders(order_number, customer_name, customer_phone)";
const SHIPMENT_REF = "shipment:shipments(shipment_number, tracking_number)";

/* ---------- Exceptions ---------- */

export async function getExceptionQueue(filters?: {
  status?: ShipmentExceptionStatus | "all" | "open";
  type?: ShipmentExceptionType | "all";
  search?: string;
}): Promise<ExceptionQueueRow[]> {
  let query = supabase
    .from("shipment_exceptions")
    .select(`*, ${ORDER_REF}, ${SHIPMENT_REF}`)
    .order("occurred_at", { ascending: false })
    .limit(200);

  const status = filters?.status ?? "open";
  if (status === "open") query = query.in("status", OPEN_EXCEPTION_STATUSES);
  else if (status !== "all") query = query.eq("status", status);

  if (filters?.type && filters.type !== "all") {
    query = query.eq("exception_type", filters.type);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as ExceptionQueueRow[];
  const term = filters?.search?.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) =>
    [
      row.order?.order_number,
      row.order?.customer_name,
      row.order?.customer_phone,
      row.shipment?.shipment_number,
      row.shipment?.tracking_number,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(term)),
  );
}

export async function getOrderExceptions(orderId: string): Promise<ExceptionQueueRow[]> {
  const { data, error } = await supabase
    .from("shipment_exceptions")
    .select(`*, ${ORDER_REF}, ${SHIPMENT_REF}`)
    .eq("order_id", orderId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ExceptionQueueRow[];
}

export async function getOpenExceptionCount(): Promise<number> {
  const { count, error } = await supabase
    .from("shipment_exceptions")
    .select("id", { count: "exact", head: true })
    .in("status", OPEN_EXCEPTION_STATUSES);
  if (error) throw error;
  return count ?? 0;
}

export async function createShipmentException(args: {
  shipmentId: string;
  exceptionType: ShipmentExceptionType;
  reason?: string | null;
  notes?: string | null;
  collectedAmount?: number | null;
}): Promise<ShipmentException> {
  const reason = args.reason?.trim();
  const notes = args.notes?.trim();
  const { data, error } = await supabase.rpc("create_shipment_exception", {
    _shipment_id: args.shipmentId,
    _exception_type: args.exceptionType,
    ...(reason ? { _reason: reason } : {}),
    ...(notes ? { _notes: notes } : {}),
    ...(args.collectedAmount != null ? { _collected_amount: args.collectedAmount } : {}),
  });
  if (error) throw error;
  return data as unknown as ShipmentException;
}

export async function setExceptionState(args: {
  exceptionId: string;
  action: ExceptionAction;
  note?: string | null;
}): Promise<ShipmentException> {
  const note = args.note?.trim();
  const { data, error } = await supabase.rpc("set_exception_state", {
    _exception_id: args.exceptionId,
    _action: args.action,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
  return data as unknown as ShipmentException;
}

/* ---------- Returns ---------- */

export async function getReturnQueue(filters?: {
  status?: OrderReturnStatus | "all" | "open";
  type?: OrderReturnType | "all";
  search?: string;
}): Promise<ReturnQueueRow[]> {
  let query = supabase
    .from("order_returns")
    .select(`*, ${ORDER_REF}, ${SHIPMENT_REF}, order_return_items(id)`)
    .order("requested_at", { ascending: false })
    .limit(200);

  const status = filters?.status ?? "open";
  if (status === "open") query = query.in("status", OPEN_RETURN_STATUSES);
  else if (status !== "all") query = query.eq("status", status);

  if (filters?.type && filters.type !== "all") {
    query = query.eq("return_type", filters.type);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as (ReturnQueueRow & {
    order_return_items: { id: string }[];
  })[]).map((row) => ({
    ...row,
    item_count: row.order_return_items?.length ?? 0,
  }));

  const term = filters?.search?.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) =>
    [
      row.return_number,
      row.order?.order_number,
      row.order?.customer_name,
      row.order?.customer_phone,
      row.shipment?.shipment_number,
      row.tracking_reference,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(term)),
  );
}

export async function getOrderReturns(orderId: string): Promise<ReturnQueueRow[]> {
  const { data, error } = await supabase
    .from("order_returns")
    .select(`*, ${ORDER_REF}, ${SHIPMENT_REF}, order_return_items(id)`)
    .eq("order_id", orderId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as (ReturnQueueRow & {
    order_return_items: { id: string }[];
  })[]).map((row) => ({ ...row, item_count: row.order_return_items?.length ?? 0 }));
}

export async function getOpenReturnCount(): Promise<number> {
  const { count, error } = await supabase
    .from("order_returns")
    .select("id", { count: "exact", head: true })
    .in("status", OPEN_RETURN_STATUSES);
  if (error) throw error;
  return count ?? 0;
}

export async function getReturnById(id: string): Promise<ReturnWithDetails | null> {
  const { data, error } = await supabase
    .from("order_returns")
    .select(
      `*, ${ORDER_REF}, ${SHIPMENT_REF},
       items:order_return_items(
         *, order_item:order_items(product_name, variant_name, sku, quantity)
       ),
       events:order_return_events(*)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const record = data as unknown as ReturnWithDetails;
  return {
    ...record,
    items: [...(record.items ?? [])].sort((a, b) =>
      (a.order_item?.product_name ?? "").localeCompare(b.order_item?.product_name ?? ""),
    ),
    events: [...(record.events ?? [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
  };
}

export async function createOrderReturn(args: {
  orderId: string;
  shipmentId?: string | null;
  returnType?: OrderReturnType;
  reason?: string | null;
  notes?: string | null;
  trackingReference?: string | null;
  items?: { orderItemId: string; quantityExpected: number; reason?: string | null }[];
}): Promise<OrderReturn> {
  const reason = args.reason?.trim();
  const notes = args.notes?.trim();
  const tracking = args.trackingReference?.trim();
  const items = (args.items ?? [])
    .filter((item) => item.quantityExpected > 0)
    .map((item) => ({
      order_item_id: item.orderItemId,
      quantity_expected: item.quantityExpected,
      ...(item.reason?.trim() ? { reason: item.reason.trim() } : {}),
    }));

  const { data, error } = await supabase.rpc("create_order_return", {
    _order_id: args.orderId,
    ...(args.shipmentId ? { _shipment_id: args.shipmentId } : {}),
    ...(args.returnType ? { _return_type: args.returnType } : {}),
    ...(reason ? { _reason: reason } : {}),
    ...(notes ? { _notes: notes } : {}),
    ...(tracking ? { _tracking_reference: tracking } : {}),
    ...(items.length ? { _items: items } : {}),
  });
  if (error) throw error;
  return data as unknown as OrderReturn;
}

export async function setReturnState(args: {
  returnId: string;
  action: ReturnAction;
  reason?: string | null;
}): Promise<OrderReturn> {
  const reason = args.reason?.trim();
  const { data, error } = await supabase.rpc("set_return_state", {
    _return_id: args.returnId,
    _action: args.action,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as OrderReturn;
}

/**
 * Physical receipt. Received quantities are recorded exactly as counted — the
 * expected quantity is never assumed to be what actually came back.
 */
export async function recordReturnReceipt(args: {
  returnId: string;
  items: { itemId: string; quantityReceived: number; notes?: string | null }[];
  note?: string | null;
}): Promise<OrderReturn> {
  const note = args.note?.trim();
  const { data, error } = await supabase.rpc("record_return_receipt", {
    _return_id: args.returnId,
    _items: args.items.map((item) => ({
      id: item.itemId,
      quantity_received: item.quantityReceived,
      ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
    })),
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
  return data as unknown as OrderReturn;
}

/** Condition grading. Accepted quantity can never exceed received quantity. */
export async function inspectReturnItems(args: {
  returnId: string;
  items: {
    itemId: string;
    condition: ReturnItemCondition;
    quantityAccepted: number;
    notes?: string | null;
  }[];
  note?: string | null;
}): Promise<OrderReturn> {
  const note = args.note?.trim();
  const { data, error } = await supabase.rpc("inspect_return_items", {
    _return_id: args.returnId,
    _items: args.items.map((item) => ({
      id: item.itemId,
      condition: item.condition,
      quantity_accepted: item.quantityAccepted,
      ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
    })),
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
  return data as unknown as OrderReturn;
}
