import { supabase } from "@/integrations/supabase/client";
import type {
  AutomationCondition,
  AutomationExecution,
  AutomationReplayResult,
  AutomationRegistry,
  AutomationRule,
  AutomationRuleStatus,
} from "@/types/automation";

/**
 * Automation data access.
 *
 * Rules and history are read directly (RLS enforced). Every write goes through
 * the controlled database functions — the automation tables reject direct
 * client writes, so the engine stays the single execution path.
 */

export async function getAutomationRegistry(): Promise<AutomationRegistry> {
  const { data, error } = await supabase.rpc("automation_registry");
  if (error) throw error;
  return data as unknown as AutomationRegistry;
}

export async function getAutomationRules(includeArchived = false): Promise<AutomationRule[]> {
  let query = supabase
    .from("automation_rules")
    .select(
      "id, name, description, trigger_type, condition_mode, conditions, action_type, action_config, status, priority, created_at, updated_at",
    )
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.neq("status", "archived");
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AutomationRule[];
}

export interface AutomationRuleInput {
  id?: string;
  name: string;
  description?: string | null;
  trigger_type: string;
  condition_mode: string;
  conditions: AutomationCondition[];
  action_type: string;
  action_config: Record<string, unknown>;
  priority: string;
  status?: AutomationRuleStatus;
}

export async function saveAutomationRule(input: AutomationRuleInput): Promise<AutomationRule> {
  const { data, error } = await supabase.rpc("save_automation_rule", {
    _payload: JSON.parse(JSON.stringify(input)) as never,
  });
  if (error) throw error;
  return data as unknown as AutomationRule;
}

export async function setAutomationRuleStatus(
  ruleId: string,
  status: AutomationRuleStatus,
): Promise<void> {
  const { error } = await supabase.rpc("set_automation_rule_status", {
    _rule_id: ruleId,
    _status: status,
  });
  if (error) throw error;
}

/**
 * Replay a failed automation execution. Admin-only and capped by the database
 * at three replay attempts; the original execution row is never modified —
 * the replay is recorded as a new execution.
 */
export async function replayAutomationExecution(
  executionId: string,
): Promise<AutomationReplayResult> {
  const { data, error } = await supabase.rpc("automation_replay_execution", {
    _execution_id: executionId,
  });
  if (error) throw error;
  return data as unknown as AutomationReplayResult;
}

export interface ExecutionFilters {
  ruleId?: string | null;
  status?: string | null;
  limit?: number;
}

export async function getAutomationExecutions(
  filters: ExecutionFilters = {},
): Promise<AutomationExecution[]> {
  let query = supabase
    .from("automation_rule_executions")
    .select(
      "id, rule_id, source_event_id, event_type, entity_type, entity_id, status, result, error_message, automation_depth, created_at, completed_at, automation_rules(name)",
    )
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);
  if (filters.ruleId) query = query.eq("rule_id", filters.ruleId);
  if (filters.status) query = query.eq("status", filters.status as never);
  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const { automation_rules: rule, ...rest } = row as typeof row & {
      automation_rules: { name: string } | null;
    };
    return { ...rest, rule_name: rule?.name ?? null } as unknown as AutomationExecution;
  });
}

/* ---------------- Presentation helpers ---------------- */

export function describeCondition(condition: AutomationCondition): string {
  const value = condition.value;
  if (condition.operator === "exists") return `${condition.field} is present`;
  const rendered = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return `${condition.field} ${condition.operator.replaceAll("_", " ")} ${rendered}`;
}

export function describeAction(
  actionType: string,
  config: Record<string, unknown>,
): string {
  switch (actionType) {
    case "set_verification_priority":
      return `Set verification priority to ${String(config["priority"] ?? "")}`;
    case "move_to_manual_review":
      return `Move to manual review — ${String(config["reason"] ?? "")}`;
    case "assign_operational_work":
      return "Assign operational work";
    case "create_internal_note":
      return `Add internal note — ${String(config["note"] ?? "")}`;
    default:
      return actionType;
  }
}
