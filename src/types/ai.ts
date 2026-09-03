/**
 * AI Brain types.
 *
 * AI Brain is an intelligence layer only. Nothing here is authoritative:
 * orders, verification, fulfillment, shipments, returns, inventory,
 * procurement, customers, financials, operations and automation remain the
 * single source of truth. AI output is stored as observations
 * (insights) and suggestions (recommendations) that a human reviews before any
 * authoritative workflow runs.
 */

export type AIAnalysisType =
  | "operations_summary"
  | "order_review"
  | "customer_review"
  | "inventory_review"
  | "delivery_review"
  | "courier_review"
  | "procurement_review"
  | "financial_review";

export type AIAnalysisStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AIAnalysisSource = "ai_provider" | "system";

export type AIInsightCategory =
  | "operations"
  | "order"
  | "customer"
  | "inventory"
  | "delivery"
  | "courier"
  | "procurement"
  | "financial"
  | "verification"
  | "general";

export type AIInsightSeverity = "info" | "low" | "medium" | "high" | "critical";

export type AIInsightStatus = "active" | "acknowledged" | "dismissed" | "expired";

export type AIRecommendationPriority = "low" | "medium" | "high" | "urgent";

export type AIRecommendationStatus =
  | "pending"
  | "accepted"
  | "dismissed"
  | "executed"
  | "expired";

export interface AIAnalysisRun {
  id: string;
  analysis_type: AIAnalysisType;
  entity_type: string;
  entity_id: string | null;
  status: AIAnalysisStatus;
  provider: string | null;
  model: string | null;
  source: AIAnalysisSource;
  requested_by: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  insight_count: number;
  recommendation_count: number;
  summary: string | null;
  created_at: string;
}

export interface AIInsight {
  id: string;
  analysis_run_id: string;
  entity_type: string;
  entity_id: string | null;
  category: AIInsightCategory;
  severity: AIInsightSeverity;
  title: string;
  summary: string;
  confidence: number;
  evidence: Record<string, unknown>;
  status: AIInsightStatus;
  reviewed_at: string | null;
  created_at: string;
  expires_at: string | null;
  /** Set when a newer run replaced this insight for the same scope. */
  superseded_at: string | null;
  superseded_by_run_id: string | null;
}

/** Derived state shown in the UI — never stored. */
export type AIInsightFreshness = "current" | "superseded" | "expired" | "reviewed";

export function insightFreshness(insight: AIInsight): AIInsightFreshness {
  if (insight.status !== "active") return "reviewed";
  if (insight.superseded_at) return "superseded";
  if (insight.expires_at && new Date(insight.expires_at) <= new Date()) return "expired";
  return "current";
}

export interface AIRecommendation {
  id: string;
  analysis_run_id: string;
  insight_id: string | null;
  entity_type: string;
  entity_id: string | null;
  recommendation_type: string;
  priority: AIRecommendationPriority;
  title: string;
  description: string;
  suggested_action: string | null;
  action_target: string | null;
  confidence: number;
  status: AIRecommendationStatus;
  reviewed_at: string | null;
  created_at: string;
}

export interface AIBrainOverview {
  /** Active, not superseded and not expired. */
  active_insights: number;
  critical_insights: number;
  superseded_insights: number;
  expired_insights: number;
  pending_recommendations: number;
  runs_last_7_days: number;
  failed_runs_last_7_days: number;
  last_completed_at: string | null;
}

/** Provider status never contains credentials — only whether one is usable. */
export interface AIProviderStatus {
  connected: boolean;
  provider: string | null;
  model: string | null;
  message: string;
  lastSuccessfulAnalysisAt: string | null;
}

export interface AIBrainEvent {
  id: string;
  event_type: string;
  run_id: string | null;
  insight_id: string | null;
  recommendation_id: string | null;
  message: string;
  created_at: string;
}

/**
 * Deterministic operational signals derived from authoritative data.
 * These are explicitly NOT AI output and are always labelled "System Analysis".
 */
export interface SystemSignal {
  id: string;
  label: string;
  severity: AIInsightSeverity;
  detail: string;
  count: number;
  href: string;
}

export const AI_SEVERITY_LABELS: Record<AIInsightSeverity, string> = {
  info: "Info",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const AI_SEVERITY_TONE: Record<
  AIInsightSeverity,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  info: "neutral",
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};

export const AI_PRIORITY_LABELS: Record<AIRecommendationPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const AI_PRIORITY_TONE: Record<
  AIRecommendationPriority,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

export const AI_RUN_STATUS_TONE: Record<
  AIAnalysisStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  queued: "neutral",
  running: "info",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};
