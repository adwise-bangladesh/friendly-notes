export type OperationCategory =
  | "verification"
  | "fulfillment"
  | "shipping"
  | "delivery_exception"
  | "return"
  | "inventory"
  | "procurement"
  | "integration";

export type OperationSeverity = "info" | "warning" | "high" | "critical";

/** Source records that support responsibility assignment. */
export type OperationAssignmentSource =
  | "order_verification"
  | "order_fulfillment"
  | "order_return"
  | "shipment_exception";

export interface SuggestedOperationAction {
  label: string;
  href: string;
}

/**
 * A derived operational attention item. It is never persisted — it is computed
 * from the authoritative source records by `operations_attention_feed`.
 */
export interface OperationAttention {
  id: string;
  category: OperationCategory;
  severity: OperationSeverity;
  /** Kind of the authoritative record ("order", "shipment", "purchase_order", ...). */
  source_type: string;
  source_id: string;
  title: string;
  subtitle: string | null;
  state: string;
  reason: string;
  occurred_at: string;
  due_at: string | null;
  href: string;
  assignable: boolean;
  assignment_source_type: OperationAssignmentSource | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
}

export interface OperationAssignment {
  id: string;
  source_type: OperationAssignmentSource;
  source_id: string;
  assigned_to: string;
  assigned_by: string | null;
  assigned_at: string;
  note: string | null;
  released_at: string | null;
}

export interface OperationAssignmentEvent {
  id: string;
  event_type: "assigned" | "reassigned" | "released";
  assigned_to: string | null;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface OperationActivityEntry {
  id: string;
  category: string;
  event_type: string;
  message: string | null;
  reference: string | null;
  href: string;
  created_at: string;
  actor_name: string | null;
}

/**
 * A deterministic operational rule. Rules are code/configuration based and are
 * evaluated inside `operations_attention_feed`; this model documents them and
 * keeps descriptions in one place for the UI.
 */
export interface OperationRule {
  id: string;
  category: OperationCategory;
  condition: string;
  severity: OperationSeverity;
  enabled: boolean;
  description: string;
}

export const OPERATION_CATEGORY_LABELS: Record<OperationCategory, string> = {
  verification: "Verification",
  fulfillment: "Fulfillment",
  shipping: "Shipping",
  delivery_exception: "Exceptions",
  return: "Returns",
  inventory: "Inventory",
  procurement: "Procurement",
  integration: "Integrations & jobs",
};

export const OPERATION_CATEGORIES: OperationCategory[] = [
  "verification",
  "fulfillment",
  "shipping",
  "delivery_exception",
  "return",
  "inventory",
  "procurement",
  "integration",
];

export const OPERATION_SEVERITIES: OperationSeverity[] = ["critical", "high", "warning", "info"];

export const OPERATION_SEVERITY_LABELS: Record<OperationSeverity, string> = {
  info: "Info",
  warning: "Warning",
  high: "High",
  critical: "Critical",
};

export const OPERATION_SEVERITY_TONE: Record<
  OperationSeverity,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  info: "info",
  warning: "warning",
  high: "warning",
  critical: "danger",
};

export const OPERATION_SEVERITY_RANK: Record<OperationSeverity, number> = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
};

export const OPERATION_ASSIGNMENT_SOURCE_LABELS: Record<OperationAssignmentSource, string> = {
  order_verification: "Verification",
  order_fulfillment: "Fulfillment",
  order_return: "Return",
  shipment_exception: "Delivery exception",
};
