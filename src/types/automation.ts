export type AutomationTrigger =
  | "order.created"
  | "order.cancelled"
  | "verification.pending"
  | "verification.manual_review"
  | "verification.unreachable"
  | "verification.confirmed"
  | "verification.failed"
  | "fulfillment.shortage"
  | "fulfillment.qc_failed"
  | "fulfillment.on_hold"
  | "fulfillment.handover"
  | "shipment.created"
  | "shipment.on_hold"
  | "shipment.delivery_failed"
  | "shipment.delivered"
  | "shipment.returned"
  | "inventory.low_stock"
  | "inventory.out_of_stock"
  | "purchase_order.pending_approval"
  | "purchase_order.partially_received";

export type AutomationAction =
  | "set_verification_priority"
  | "move_to_manual_review"
  | "assign_operational_work"
  | "create_internal_note";

export type AutomationRuleStatus = "active" | "paused" | "archived";
export type AutomationRulePriority = "low" | "normal" | "high";
export type AutomationConditionMode = "all" | "any";
export type AutomationExecutionStatus = "pending" | "running" | "completed" | "skipped" | "failed";
export type AutomationFieldType = "text" | "number" | "boolean";

export interface AutomationCondition {
  field: string;
  operator: string;
  value?: unknown;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger_type: AutomationTrigger;
  condition_mode: AutomationConditionMode;
  conditions: AutomationCondition[];
  action_type: AutomationAction;
  action_config: Record<string, unknown>;
  status: AutomationRuleStatus;
  priority: AutomationRulePriority;
  created_at: string;
  updated_at: string;
}

export interface AutomationExecution {
  id: string;
  rule_id: string;
  rule_name: string | null;
  source_event_id: string;
  event_type: AutomationTrigger;
  entity_type: string;
  entity_id: string | null;
  status: AutomationExecutionStatus;
  result: Record<string, unknown> | null;
  error_message: string | null;
  automation_depth: number;
  created_at: string;
  completed_at: string | null;
}

export interface AutomationTriggerDefinition {
  entity_type: string;
  fields: Record<string, AutomationFieldType>;
  actions: AutomationAction[];
}

export interface AutomationRegistry {
  max_depth: number;
  operators: Record<AutomationFieldType, string[]>;
  triggers: Record<string, AutomationTriggerDefinition>;
}

export const AUTOMATION_STATUS_TONE: Record<
  AutomationRuleStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  active: "success",
  paused: "warning",
  archived: "neutral",
};

export const AUTOMATION_EXECUTION_TONE: Record<
  AutomationExecutionStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  pending: "neutral",
  running: "info",
  completed: "success",
  skipped: "neutral",
  failed: "danger",
};

export const AUTOMATION_ACTION_LABELS: Record<AutomationAction, string> = {
  set_verification_priority: "Set verification priority",
  move_to_manual_review: "Move to manual review",
  assign_operational_work: "Assign operational work",
  create_internal_note: "Create internal note",
};

export const AUTOMATION_OPERATOR_LABELS: Record<string, string> = {
  equals: "equals",
  not_equals: "does not equal",
  greater_than: "greater than",
  greater_than_or_equal: "greater than or equal",
  less_than: "less than",
  less_than_or_equal: "less than or equal",
  contains: "contains",
  in: "is one of",
  not_in: "is not one of",
  exists: "is present",
};
