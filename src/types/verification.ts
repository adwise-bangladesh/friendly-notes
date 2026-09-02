import type { Database } from "@/integrations/supabase/types";
import type { StatusTone } from "@/components/shared/StatusBadge";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

/* ---------- Enums ---------- */

export type VerificationStatus = Enums["order_verification_status"];
export type VerificationPriority = Enums["verification_priority"];
export type RiskLevel = Enums["verification_risk_level"];
export type VerificationMethod = Enums["verification_method"];
export type VerificationAttemptStatus = Enums["verification_attempt_status"];
export type VerificationAttemptOutcome = Enums["verification_attempt_outcome"];
export type VerificationEventType = Enums["verification_event_type"];

export type VerificationAttempt = Tables["order_verification_attempts"]["Row"];
export type VerificationEvent = Tables["order_verification_events"]["Row"];

/**
 * Centralised retry configuration — mirrors public.verification_max_attempts().
 * Never hardcode the number anywhere else.
 */
export const VERIFICATION_MAX_ATTEMPTS = 3;

/* ---------- Status ---------- */

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  "not_required",
  "pending",
  "in_progress",
  "manual_review",
  "rescheduled",
  "confirmed",
  "unreachable",
  "failed",
  "cancelled",
];

/** Statuses the operations queue works on. */
export const VERIFICATION_QUEUE_STATUSES: VerificationStatus[] = [
  "pending",
  "in_progress",
  "manual_review",
  "rescheduled",
  "unreachable",
];

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  not_required: "Not required",
  pending: "Pending",
  in_progress: "In progress",
  manual_review: "Manual review",
  rescheduled: "Rescheduled",
  confirmed: "Confirmed",
  unreachable: "Unreachable",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const VERIFICATION_STATUS_MEANINGS: Record<VerificationStatus, string> = {
  not_required: "Verification is not required for this order.",
  pending: "Waiting for a verification contact attempt.",
  in_progress: "A verification process is currently active.",
  manual_review: "Needs human attention before it can be confirmed.",
  rescheduled: "The customer asked to be contacted later; a callback is scheduled.",
  confirmed: "The customer confirmed the order. Ready for the next operational step.",
  unreachable: "Maximum contact attempts exhausted without reaching the customer.",
  failed: "Verification failed — a reason is recorded.",
  cancelled: "Verification ended because the order was cancelled.",
};

export const VERIFICATION_STATUS_TONE: Record<VerificationStatus, StatusTone> = {
  not_required: "neutral",
  pending: "warning",
  in_progress: "info",
  manual_review: "warning",
  rescheduled: "info",
  confirmed: "success",
  unreachable: "danger",
  failed: "danger",
  cancelled: "neutral",
};

/** Terminal states — no further verification work is possible. */
export function isVerificationClosed(status: VerificationStatus): boolean {
  return status === "confirmed" || status === "failed" || status === "cancelled";
}

/** Derived operational readiness indicator — never stored. */
export function isReadyForFulfillment(
  orderStatus: string,
  verificationStatus: VerificationStatus,
): boolean {
  return orderStatus === "created" && verificationStatus === "confirmed";
}

/* ---------- Priority & risk ---------- */

export const VERIFICATION_PRIORITIES: VerificationPriority[] = ["low", "normal", "high", "urgent"];
export const VERIFICATION_PRIORITY_LABELS: Record<VerificationPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
export const VERIFICATION_PRIORITY_TONE: Record<VerificationPriority, StatusTone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};

export const RISK_LEVELS: RiskLevel[] = ["none", "low", "medium", "high"];
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};
export const RISK_LEVEL_TONE: Record<RiskLevel, StatusTone> = {
  none: "neutral",
  low: "neutral",
  medium: "warning",
  high: "danger",
};

/* ---------- Method & outcome ---------- */

export const VERIFICATION_METHODS: VerificationMethod[] = [
  "manual_call",
  "ai_voice",
  "sms",
  "whatsapp",
  "other",
];
/** Only these are operable in the MVP — the rest await provider integrations. */
export const ACTIVE_VERIFICATION_METHODS: VerificationMethod[] = ["manual_call", "ai_voice"];

export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  manual_call: "Manual call",
  ai_voice: "AI voice",
  sms: "SMS",
  whatsapp: "WhatsApp",
  other: "Other",
};

export const ATTEMPT_OUTCOMES: VerificationAttemptOutcome[] = [
  "confirmed",
  "answered",
  "no_answer",
  "busy",
  "callback_requested",
  "rejected",
  "invalid_number",
  "risk_flagged",
  "failed",
];

export const ATTEMPT_OUTCOME_LABELS: Record<VerificationAttemptOutcome, string> = {
  pending: "Pending",
  answered: "Answered — no decision yet",
  confirmed: "Confirmed",
  rejected: "Rejected by customer",
  no_answer: "No answer",
  busy: "Busy",
  invalid_number: "Invalid number",
  callback_requested: "Callback requested",
  risk_flagged: "Risk flagged",
  failed: "Attempt failed",
};

export const ATTEMPT_OUTCOME_TONE: Record<VerificationAttemptOutcome, StatusTone> = {
  pending: "neutral",
  answered: "info",
  confirmed: "success",
  rejected: "danger",
  no_answer: "warning",
  busy: "warning",
  invalid_number: "danger",
  callback_requested: "info",
  risk_flagged: "danger",
  failed: "danger",
};

export const ATTEMPT_STATUS_LABELS: Record<VerificationAttemptStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Extra input an outcome requires before it can be recorded. */
export function outcomeRequirement(
  outcome: VerificationAttemptOutcome,
): "scheduled_at" | "risk_reason" | "failure_reason" | null {
  if (outcome === "callback_requested") return "scheduled_at";
  if (outcome === "risk_flagged") return "risk_reason";
  if (outcome === "rejected") return "failure_reason";
  return null;
}

/* ---------- Events ---------- */

export const VERIFICATION_EVENT_LABELS: Record<VerificationEventType, string> = {
  verification_started: "Verification started",
  attempt_created: "Attempt created",
  attempt_completed: "Attempt completed",
  callback_scheduled: "Callback scheduled",
  moved_to_manual_review: "Moved to manual review",
  risk_flagged: "Risk flagged",
  verification_confirmed: "Verification confirmed",
  verification_failed: "Verification failed",
  verification_unreachable: "Marked unreachable",
  verification_cancelled: "Verification cancelled",
  priority_changed: "Priority changed",
};

/* ---------- Allowed manual actions (UI affordance only; DB is authority) ---------- */

export type VerificationAction =
  | "start"
  | "confirm"
  | "manual_review"
  | "schedule_callback"
  | "unreachable"
  | "fail"
  | "reopen";

export function availableActions(status: VerificationStatus): VerificationAction[] {
  switch (status) {
    case "not_required":
      return [];
    case "pending":
      return ["start", "confirm", "manual_review", "schedule_callback", "unreachable", "fail"];
    case "in_progress":
      return ["confirm", "manual_review", "schedule_callback", "unreachable", "fail"];
    case "rescheduled":
      return ["start", "reopen", "manual_review"];
    case "manual_review":
      return ["confirm", "reopen", "fail", "unreachable"];
    case "unreachable":
      return ["manual_review", "reopen", "fail"];
    default:
      return [];
  }
}

/** Attempts can only be recorded while verification is still open. */
export function canRecordAttempt(orderStatus: string, status: VerificationStatus): boolean {
  return orderStatus !== "cancelled" && !isVerificationClosed(status) && status !== "not_required";
}
