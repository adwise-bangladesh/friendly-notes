import { supabase } from "@/integrations/supabase/client";
import type {
  CourierSettlement,
  CourierSettlementItem,
  FinancialAdjustmentDirection,
  FinancialAdjustmentType,
  OrderFinancialAdjustment,
  OrderFinancialSnapshot,
  SettlementItemWithContext,
  SettlementStatus,
  SettlementWithContext,
} from "@/types/finance";

/**
 * Financial data access.
 *
 * Every write goes through a SECURITY DEFINER database function: the tables
 * themselves reject direct client inserts/updates/deletes, so financial
 * history has exactly one authoritative path and cannot be silently rewritten.
 * Reads use explicit column projections — no select("*") on money tables.
 */


/** Drops undefined values so optional RPC arguments are simply omitted. */
function rpcArgs<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

const ADJUSTMENT_SELECT = `
  id, order_id, adjustment_type, direction, amount, reason, reference,
  shipment_id, return_id, settlement_id, reversal_of, reversed_at, reversed_by,
  created_by, created_at
`;

const SETTLEMENT_SELECT = `
  id, courier_account_id, settlement_reference, status, settlement_date,
  expected_amount, actual_amount, notes, finalized_at, finalized_by,
  created_by, updated_by, created_at, updated_at
`;

const SETTLEMENT_ITEM_SELECT = `
  id, settlement_id, order_id, shipment_id, expected_collected_amount,
  actual_collected_amount, delivery_charge, cod_charge, return_charge,
  other_charge, net_settlement_amount, created_at, updated_at,
  order:orders(id, order_number),
  shipment:shipments(id, shipment_number, cash_on_delivery_amount)
`;

/* ---------- Order financials ---------- */

export async function getOrderFinancials(orderId: string): Promise<OrderFinancialSnapshot> {
  const { data, error } = await supabase.rpc("order_financials", { _order_id: orderId });
  if (error) throw error;
  return data as unknown as OrderFinancialSnapshot;
}

export async function getOrderAdjustments(orderId: string): Promise<OrderFinancialAdjustment[]> {
  const { data, error } = await supabase
    .from("order_financial_adjustments")
    .select(ADJUSTMENT_SELECT)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrderFinancialAdjustment[];
}

export interface CreateAdjustmentInput {
  orderId: string;
  type: FinancialAdjustmentType;
  direction: FinancialAdjustmentDirection;
  amount: number;
  reason?: string | undefined;
  reference?: string | undefined;
  shipmentId?: string | null | undefined;
}

export async function createFinancialAdjustment(
  input: CreateAdjustmentInput,
): Promise<OrderFinancialAdjustment> {
  if (!(input.amount > 0)) throw new Error("Amount must be greater than zero");
  const { data, error } = await supabase.rpc("create_financial_adjustment", rpcArgs({
    _order_id: input.orderId,
    _adjustment_type: input.type,
    _direction: input.direction,
    _amount: input.amount,
    _reason: input.reason ?? undefined,
    _reference: input.reference ?? undefined,
    _shipment_id: input.shipmentId ?? undefined,
    _return_id: undefined,
  }));
  if (error) throw error;
  return data as unknown as OrderFinancialAdjustment;
}

export async function reverseFinancialAdjustment(
  adjustmentId: string,
  reason?: string,
): Promise<OrderFinancialAdjustment> {
  const { data, error } = await supabase.rpc("reverse_financial_adjustment", rpcArgs({
    _adjustment_id: adjustmentId,
    _reason: reason ?? undefined,
  }));
  if (error) throw error;
  return data as unknown as OrderFinancialAdjustment;
}

/* ---------- Shipment actual courier money ---------- */

export interface ShipmentFinancialsInput {
  shipmentId: string;
  collectedAmount?: number | null;
  actualDeliveryFee?: number | null;
  codFee?: number | null;
  returnCharge?: number | null;
  otherCourierCharge?: number | null;
  note?: string | undefined;
}

export async function recordShipmentFinancials(input: ShipmentFinancialsInput): Promise<void> {
  const { error } = await supabase.rpc("record_shipment_financials", rpcArgs({
    _shipment_id: input.shipmentId,
    _collected_amount: input.collectedAmount ?? undefined,
    _actual_delivery_fee: input.actualDeliveryFee ?? undefined,
    _cod_fee: input.codFee ?? undefined,
    _return_charge: input.returnCharge ?? undefined,
    _other_courier_charge: input.otherCourierCharge ?? undefined,
    _note: input.note ?? undefined,
  }));
  if (error) throw error;
}

/* ---------- Courier settlements ---------- */

export interface SettlementFilters {
  search?: string;
  status?: SettlementStatus | "all";
  accountId?: string | "all";
}

export async function getCourierSettlements(
  filters: SettlementFilters = {},
): Promise<SettlementWithContext[]> {
  let query = supabase
    .from("courier_settlements")
    .select(
      `${SETTLEMENT_SELECT},
       account:courier_accounts(id, name, code, provider_id),
       items:courier_settlement_items(count)`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.accountId && filters.accountId !== "all") {
    query = query.eq("courier_account_id", filters.accountId);
  }
  const term = filters.search?.trim();
  if (term) query = query.ilike("settlement_reference", `%${term}%`);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as (CourierSettlement & {
    account: { id: string; name: string; code: string; provider_id: string } | null;
    items: { count: number }[];
  })[];

  const providerIds = [...new Set(rows.map((r) => r.account?.provider_id).filter(Boolean))] as string[];
  const providers = new Map<string, string>();
  if (providerIds.length > 0) {
    const { data: provs } = await supabase
      .from("courier_providers")
      .select("id, name")
      .in("id", providerIds);
    for (const p of provs ?? []) providers.set(p.id, p.name);
  }

  return rows.map((r) => ({
    ...r,
    provider_name: r.account ? (providers.get(r.account.provider_id) ?? null) : null,
    item_count: r.items?.[0]?.count ?? 0,
  }));
}

export async function getCourierSettlement(id: string): Promise<{
  settlement: SettlementWithContext;
  items: SettlementItemWithContext[];
} | null> {
  const { data, error } = await supabase
    .from("courier_settlements")
    .select(`${SETTLEMENT_SELECT}, account:courier_accounts(id, name, code, provider_id)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as CourierSettlement & {
    account: { id: string; name: string; code: string; provider_id: string } | null;
  };

  let providerName: string | null = null;
  if (row.account) {
    const { data: prov } = await supabase
      .from("courier_providers")
      .select("name")
      .eq("id", row.account.provider_id)
      .maybeSingle();
    providerName = prov?.name ?? null;
  }

  const { data: items, error: itemError } = await supabase
    .from("courier_settlement_items")
    .select(SETTLEMENT_ITEM_SELECT)
    .eq("settlement_id", id)
    .order("created_at", { ascending: true });
  if (itemError) throw itemError;

  return {
    settlement: { ...row, provider_name: providerName, item_count: (items ?? []).length },
    items: (items ?? []) as unknown as SettlementItemWithContext[],
  };
}

export async function getCourierAccountOptions(): Promise<
  { id: string; name: string; code: string }[]
> {
  const { data, error } = await supabase
    .from("courier_accounts")
    .select("id, name, code")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/** Delivered / returned shipments that are not yet on any live settlement. */
export async function getSettleableShipments(
  courierAccountId: string,
): Promise<{ id: string; shipment_number: string; order_id: string; cash_on_delivery_amount: number; status: string }[]> {
  const { data, error } = await supabase
    .from("shipments")
    .select("id, shipment_number, order_id, cash_on_delivery_amount, status")
    .eq("courier_account_id", courierAccountId)
    .in("status", ["delivered", "partial_delivered", "return_received", "delivery_failed", "lost"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const { data: taken } = await supabase
    .from("courier_settlement_items")
    .select("shipment_id, settlement:courier_settlements(status)");
  const used = new Set(
    ((taken ?? []) as unknown as { shipment_id: string; settlement: { status: string } | null }[])
      .filter((t) => t.settlement?.status !== "cancelled")
      .map((t) => t.shipment_id),
  );

  return (data ?? []).filter((s) => !used.has(s.id));
}

export async function createCourierSettlement(input: {
  courierAccountId: string;
  reference: string;
  settlementDate?: string | null | undefined;
  notes?: string | undefined;
}): Promise<CourierSettlement> {
  const { data, error } = await supabase.rpc("create_courier_settlement", rpcArgs({
    _courier_account_id: input.courierAccountId,
    _settlement_reference: input.reference,
    _settlement_date: input.settlementDate ?? undefined,
    _notes: input.notes ?? undefined,
  }));
  if (error) throw error;
  return data as unknown as CourierSettlement;
}

export async function addSettlementItem(
  settlementId: string,
  shipmentId: string,
): Promise<CourierSettlementItem> {
  const { data, error } = await supabase.rpc("add_settlement_item", rpcArgs({
    _settlement_id: settlementId,
    _shipment_id: shipmentId,
  }));
  if (error) throw error;
  return data as unknown as CourierSettlementItem;
}

export async function removeSettlementItem(itemId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_settlement_item", { _item_id: itemId });
  if (error) throw error;
}

export interface SettlementActualsInput {
  itemId: string;
  actualCollectedAmount?: number | null;
  deliveryCharge?: number | null;
  codCharge?: number | null;
  returnCharge?: number | null;
  otherCharge?: number | null;
}

export async function recordSettlementActuals(
  input: SettlementActualsInput,
): Promise<CourierSettlementItem> {
  const { data, error } = await supabase.rpc("record_settlement_actuals", rpcArgs({
    _item_id: input.itemId,
    _actual_collected_amount: input.actualCollectedAmount ?? undefined,
    _delivery_charge: input.deliveryCharge ?? undefined,
    _cod_charge: input.codCharge ?? undefined,
    _return_charge: input.returnCharge ?? undefined,
    _other_charge: input.otherCharge ?? undefined,
  }));
  if (error) throw error;
  return data as unknown as CourierSettlementItem;
}

export async function setSettlementStatus(
  settlementId: string,
  status: SettlementStatus,
  note?: string,
): Promise<CourierSettlement> {
  const { data, error } = await supabase.rpc("set_settlement_status", rpcArgs({
    _settlement_id: settlementId,
    _status: status,
    _note: note ?? undefined,
  }));
  if (error) throw error;
  return data as unknown as CourierSettlement;
}
