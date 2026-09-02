import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OPERATION_ATTENTION_CONFIG } from "@/lib/operations-config";

/**
 * Context builders.
 *
 * Rules that apply to every builder here:
 *  - the caller's own RLS-scoped client is used, so context can never contain
 *    data the caller is not allowed to read;
 *  - only the fields an analysis genuinely needs are selected — never
 *    `select("*")`;
 *  - personal data (names, phone numbers, emails, addresses) is excluded.
 *    Analyses work on operational shape, not on customer identity;
 *  - credential, token and provider-secret tables are never touched.
 */

export type AuthedClient = SupabaseClient<Database>;

export interface AnalysisContext {
  /** Compact JSON handed to the provider. */
  data: Record<string, unknown>;
  /** Tiny descriptor persisted with the run (no records, just shape). */
  summary: Record<string, unknown>;
}

const EMPTY: Record<string, unknown> = {};

/* ------------------------------------------------------------------ operations */

export async function buildOperationsContext(client: AuthedClient): Promise<AnalysisContext> {
  const { data, error } = await client.rpc("operations_attention_feed", {
    _verification_pending_hours: OPERATION_ATTENTION_CONFIG.verification_pending_hours,
    _picking_stale_hours: OPERATION_ATTENTION_CONFIG.picking_stale_hours,
    _shipment_stale_hours: OPERATION_ATTENTION_CONFIG.shipment_stale_hours,
    _transfer_stale_hours: OPERATION_ATTENTION_CONFIG.transfer_stale_hours,
    _stocktake_stale_hours: OPERATION_ATTENTION_CONFIG.stocktake_stale_hours,
    _purchase_order_overdue_days: OPERATION_ATTENTION_CONFIG.purchase_order_overdue_days,
    _low_stock_default: OPERATION_ATTENTION_CONFIG.low_stock_default,
    _limit: 120,
  });
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    category: string;
    severity: string;
    state: string;
    reason: string;
    source_type: string;
    source_id: string;
    due_at: string | null;
    occurred_at: string;
  }[];

  const now = Date.now();
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let overdue = 0;
  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
    if (row.due_at && new Date(row.due_at).getTime() < now) overdue += 1;
  }

  // Only the highest-signal rows are sent, and only their operational shape.
  const items = rows
    .filter((row) => row.severity === "critical" || row.severity === "high")
    .slice(0, 30)
    .map((row) => ({
      category: row.category,
      severity: row.severity,
      state: row.state,
      reason: row.reason,
      source_type: row.source_type,
      source_id: row.source_id,
      overdue: row.due_at ? new Date(row.due_at).getTime() < now : false,
      age_hours: Math.round((now - new Date(row.occurred_at).getTime()) / 3_600_000),
    }));

  return {
    data: { total_attention_items: rows.length, overdue, by_category: byCategory, by_severity: bySeverity, items },
    summary: { attention_items: rows.length, overdue, categories: Object.keys(byCategory).length },
  };
}

/* ----------------------------------------------------------------------- order */

export async function buildOrderContext(
  client: AuthedClient,
  orderId: string,
): Promise<AnalysisContext> {
  const { data: order, error } = await client
    .from("orders")
    .select(
      "id, order_number, status, payment_status, verification_status, fulfillment_status, delivery_status, financial_status, risk_level, verification_attempt_count, subtotal, grand_total, payment_method, created_at, customer_id",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) throw new Error("Order not found");

  const [items, attempts, shipments, returns, metrics] = await Promise.all([
    client.from("order_items").select("quantity, unit_price, line_total").eq("order_id", orderId),
    client
      .from("order_verification_attempts")
      .select("outcome, method, status, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(10),
    client
      .from("shipments")
      .select("id, status, cash_on_delivery_amount, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(5),
    client.from("order_returns").select("id, status, created_at").eq("order_id", orderId).limit(5),
    order.customer_id
      ? client.rpc("customer_metrics", { _customer_id: order.customer_id })
      : Promise.resolve({ data: null, error: null }),
  ]);

  const shipmentIds = (shipments.data ?? []).map((s) => s.id);
  const exceptions = shipmentIds.length
    ? await client
        .from("shipment_exceptions")
        .select("exception_type, status, created_at")
        .in("shipment_id", shipmentIds)
        .limit(10)
    : { data: [] };

  const itemRows = items.data ?? [];

  return {
    data: {
      order: {
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        verification_status: order.verification_status,
        fulfillment_status: order.fulfillment_status,
        delivery_status: order.delivery_status,
        financial_status: order.financial_status,
        payment_method: order.payment_method,
        risk_level: order.risk_level,
        verification_attempt_count: order.verification_attempt_count,
        grand_total: order.grand_total,
        item_count: itemRows.length,
        unit_count: itemRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
        age_hours: Math.round((Date.now() - new Date(order.created_at).getTime()) / 3_600_000),
      },
      verification_attempts: (attempts.data ?? []).map((a) => ({
        outcome: a.outcome,
        method: a.method,
        status: a.status,
      })),
      shipments: (shipments.data ?? []).map((s) => ({
        status: s.status,
        cod_amount: s.cash_on_delivery_amount,
      })),
      exceptions: (exceptions.data ?? []).map((e) => ({
        type: e.exception_type,
        status: e.status,
      })),
      returns: (returns.data ?? []).map((r) => ({ status: r.status })),
      // Aggregated behaviour only — no personal identity fields.
      customer_metrics: metrics.data ?? null,
    },
    summary: {
      order_number: order.order_number,
      items: itemRows.length,
      attempts: (attempts.data ?? []).length,
      shipments: (shipments.data ?? []).length,
    },
  };
}

/* -------------------------------------------------------------------- customer */

export async function buildCustomerContext(
  client: AuthedClient,
  customerId: string,
): Promise<AnalysisContext> {
  const { data: customer, error } = await client
    .from("customers")
    .select("id, status, created_at")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw error;
  if (!customer) throw new Error("Customer not found");

  const [metrics, financial, flags, orders] = await Promise.all([
    client.rpc("customer_metrics", { _customer_id: customerId }),
    client.rpc("customer_financial_summary", { _customer_id: customerId }),
    client
      .from("customer_manual_flags")
      .select("flag, created_at")
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .limit(10),
    client
      .from("orders")
      .select("status, verification_status, delivery_status, grand_total, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return {
    data: {
      customer: {
        status: customer.status,
        tenure_days: Math.round(
          (Date.now() - new Date(customer.created_at).getTime()) / 86_400_000,
        ),
      },
      metrics: metrics.data ?? null,
      financial: financial.data ?? null,
      manual_flags: (flags.data ?? []).map((f) => f.flag),
      recent_orders: (orders.data ?? []).map((o) => ({
        status: o.status,
        verification_status: o.verification_status,
        delivery_status: o.delivery_status,
        grand_total: o.grand_total,
      })),
    },
    summary: { recent_orders: (orders.data ?? []).length, flags: (flags.data ?? []).length },
  };
}

/* ------------------------------------------------------------------- inventory */

export async function buildInventoryContext(client: AuthedClient): Promise<AnalysisContext> {
  const [levels, transfers, stocktakes] = await Promise.all([
    client
      .from("inventory_levels")
      .select("id, on_hand, reserved, damaged, incoming, low_stock_threshold, product_id, variant_id")
      .order("on_hand", { ascending: true })
      .limit(80),
    client
      .from("inventory_transfers")
      .select("status, created_at")
      .in("status", ["pending", "in_transit"])
      .limit(50),
    client
      .from("stocktakes")
      .select("status, created_at")
      .in("status", ["draft", "in_progress"])
      .limit(50),
  ]);

  const rows = levels.data ?? [];
  const threshold = OPERATION_ATTENTION_CONFIG.low_stock_default;
  const outOfStock = rows.filter((row) => (row.on_hand ?? 0) <= 0).length;
  const lowStock = rows.filter((row) => {
    const limit = row.low_stock_threshold ?? threshold;
    return (row.on_hand ?? 0) > 0 && (row.on_hand ?? 0) <= limit;
  }).length;
  const damaged = rows.reduce((sum, row) => sum + (row.damaged ?? 0), 0);

  return {
    data: {
      tracked_records: rows.length,
      out_of_stock: outOfStock,
      low_stock: lowStock,
      damaged_units: damaged,
      open_transfers: (transfers.data ?? []).length,
      open_stocktakes: (stocktakes.data ?? []).length,
      lowest_levels: rows.slice(0, 20).map((row) => ({
        product_id: row.product_id,
        variant_id: row.variant_id,
        on_hand: row.on_hand,
        reserved: row.reserved,
        incoming: row.incoming,
        threshold: row.low_stock_threshold ?? threshold,
      })),
    },
    summary: { out_of_stock: outOfStock, low_stock: lowStock, tracked: rows.length },
  };
}

export async function buildContext(
  builder: "operations" | "order" | "customer" | "inventory",
  client: AuthedClient,
  entityId: string | null,
): Promise<AnalysisContext> {
  switch (builder) {
    case "operations":
      return buildOperationsContext(client);
    case "inventory":
      return buildInventoryContext(client);
    case "order":
      if (!entityId) throw new Error("An order is required for this analysis");
      return buildOrderContext(client, entityId);
    case "customer":
      if (!entityId) throw new Error("A customer is required for this analysis");
      return buildCustomerContext(client, entityId);
    default:
      return { data: EMPTY, summary: EMPTY };
  }
}
