import type { OperationRule } from "@/types/operations";

/**
 * Centralised operational attention configuration.
 *
 * These are the ONLY SLA-style thresholds in the system. They are passed into
 * `operations_attention_feed` so the database evaluates every rule with the
 * same numbers the UI documents — no magic numbers inside components.
 */
export const OPERATION_ATTENTION_CONFIG = {
  /** Order pending verification longer than this escalates to high. Default 6h. */
  verification_pending_hours: 6,
  /** A rescheduled callback is overdue as soon as its scheduled time passes. */
  callback_overdue_minutes: 0,
  /** Picking in progress longer than this escalates to high. Default 4h. */
  picking_stale_hours: 4,
  /** No courier update within this window marks a shipment stale. Default 24h. */
  shipment_stale_hours: 24,
  /** Transfer pending / in transit longer than this needs attention. Default 48h. */
  transfer_stale_hours: 48,
  /** Stocktake open longer than this is stale. Default 72h. */
  stocktake_stale_hours: 72,
  /** Days past the expected delivery date before a PO counts as overdue. Default 3. */
  purchase_order_overdue_days: 3,
  /** Low-stock fallback when an inventory level has no explicit threshold. */
  low_stock_default: 5,
  /** Hard cap on derived items fetched per load. */
  feed_limit: 500,
} as const;

export type OperationAttentionConfig = typeof OPERATION_ATTENTION_CONFIG;

/**
 * Documentation of the deterministic rules evaluated by
 * `operations_attention_feed`. Kept in one place so operational logic is
 * discoverable instead of scattered across modules.
 */
export const OPERATION_RULES: OperationRule[] = [
  {
    id: "verification.pending",
    category: "verification",
    condition: "verification_status = pending",
    severity: "info",
    enabled: true,
    description: `Escalates to high after ${OPERATION_ATTENTION_CONFIG.verification_pending_hours}h.`,
  },
  {
    id: "verification.manual_review",
    category: "verification",
    condition: "verification_status = manual_review",
    severity: "high",
    enabled: true,
    description: "Order flagged for manual review.",
  },
  {
    id: "verification.callback_overdue",
    category: "verification",
    condition: "verification_status = rescheduled AND next_action_at < now()",
    severity: "high",
    enabled: true,
    description: "Scheduled callback is overdue.",
  },
  {
    id: "verification.unreachable",
    category: "verification",
    condition: "verification_status = unreachable",
    severity: "warning",
    enabled: true,
    description: "Customer could not be reached.",
  },
  {
    id: "verification.priority",
    category: "verification",
    condition: "verification_priority in (high, urgent)",
    severity: "critical",
    enabled: true,
    description: "Urgent priority becomes critical, high priority at least high.",
  },
  {
    id: "fulfillment.ready_not_started",
    category: "fulfillment",
    condition: "order.fulfillment_status = ready AND no active fulfillment record",
    severity: "warning",
    enabled: true,
    description: "Order is ready to pick but warehouse work has not started.",
  },
  {
    id: "fulfillment.blocked",
    category: "fulfillment",
    condition: "fulfillment.status in (qc_failed, on_hold) OR item shortage",
    severity: "critical",
    enabled: true,
    description: "Warehouse work is operationally blocked.",
  },
  {
    id: "fulfillment.picking_stale",
    category: "fulfillment",
    condition: `picking started more than ${OPERATION_ATTENTION_CONFIG.picking_stale_hours}h ago`,
    severity: "high",
    enabled: true,
    description: "Picking has been in progress too long.",
  },
  {
    id: "fulfillment.handover",
    category: "fulfillment",
    condition: "fulfillment.status = ready_for_handover",
    severity: "warning",
    enabled: true,
    description: "Packed order awaiting courier handover.",
  },
  {
    id: "shipping.not_booked",
    category: "shipping",
    condition: "shipment.status in (draft, ready_for_booking)",
    severity: "warning",
    enabled: true,
    description: "Shipment exists but has not been booked with a courier.",
  },
  {
    id: "shipping.failed",
    category: "shipping",
    condition: "shipment.status in (booking_failed, pickup_failed, delivery_failed, lost)",
    severity: "critical",
    enabled: true,
    description: "Courier booking, pickup or delivery failed.",
  },
  {
    id: "shipping.on_hold",
    category: "shipping",
    condition: "shipment.status = delivery_on_hold",
    severity: "high",
    enabled: true,
    description: "Courier placed the delivery on hold.",
  },
  {
    id: "shipping.stale",
    category: "shipping",
    condition: `no courier update for ${OPERATION_ATTENTION_CONFIG.shipment_stale_hours}h while in transit`,
    severity: "high",
    enabled: true,
    description: "Courier status has not moved recently.",
  },
  {
    id: "shipping.unmapped_event",
    category: "shipping",
    condition: "courier_provider_events.processing_status in (unmatched, rejected)",
    severity: "warning",
    enabled: true,
    description: "Courier event could not be applied and needs review.",
  },
  {
    id: "delivery_exception.open",
    category: "delivery_exception",
    condition: "shipment_exceptions.status in (open, under_review)",
    severity: "high",
    enabled: true,
    description: "Delivery exception is unresolved.",
  },
  {
    id: "return.pending",
    category: "return",
    condition: "order_returns.status in (pending, in_transit)",
    severity: "warning",
    enabled: true,
    description: "Return awaiting physical receipt.",
  },
  {
    id: "return.ungraded",
    category: "return",
    condition: "order_returns.status = received AND inspected_at is null",
    severity: "high",
    enabled: true,
    description: "Received return has not been graded.",
  },
  {
    id: "return.financial",
    category: "return",
    condition: "order_returns.status = inspected",
    severity: "warning",
    enabled: true,
    description: "Return awaiting financial resolution.",
  },
  {
    id: "inventory.stock",
    category: "inventory",
    condition: "available_quantity <= low_stock_threshold",
    severity: "warning",
    enabled: true,
    description: `Out of stock is high severity; fallback threshold is ${OPERATION_ATTENTION_CONFIG.low_stock_default}.`,
  },
  {
    id: "inventory.transfer_stale",
    category: "inventory",
    condition: `transfer pending / in transit more than ${OPERATION_ATTENTION_CONFIG.transfer_stale_hours}h`,
    severity: "high",
    enabled: true,
    description: "Stock transfer has not progressed.",
  },
  {
    id: "inventory.stocktake_stale",
    category: "inventory",
    condition: `stocktake open more than ${OPERATION_ATTENTION_CONFIG.stocktake_stale_hours}h`,
    severity: "warning",
    enabled: true,
    description: "Stocktake left open.",
  },
  {
    id: "procurement.awaiting_approval",
    category: "procurement",
    condition: "purchase_orders.status in (pending_approval, approved, partially_received)",
    severity: "warning",
    enabled: true,
    description: "Purchase order needs approval, ordering or receiving.",
  },
  {
    id: "procurement.overdue",
    category: "procurement",
    condition: `expected_delivery_date older than ${OPERATION_ATTENTION_CONFIG.purchase_order_overdue_days} days`,
    severity: "high",
    enabled: true,
    description: "Supplier delivery is overdue.",
  },
];

/** Severities that count as operationally blocked. */
export const BLOCKED_STATES = [
  "qc_failed",
  "on_hold",
  "booking_failed",
  "pickup_failed",
  "delivery_failed",
  "delivery_on_hold",
  "lost",
  "out_of_stock",
];
