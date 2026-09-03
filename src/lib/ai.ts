import { supabase } from "@/integrations/supabase/client";
import { getAttentionFeed } from "@/lib/operations";
import type {
  AIAnalysisRun,
  AIBrainEvent,
  AIBrainOverview,
  AIInsight,
  AIInsightStatus,
  AIRecommendation,
  AIRecommendationStatus,
  SystemSignal,
} from "@/types/ai";

/**
 * AI Brain data access.
 *
 * Reads are RLS-scoped and always select explicit columns. Every state change
 * goes through a controlled database function — the AI tables reject direct
 * client writes, and insight/recommendation content is immutable.
 */

const RUN_COLUMNS =
  "id, analysis_type, entity_type, entity_id, status, provider, model, source, requested_by, started_at, completed_at, duration_ms, error_message, insight_count, recommendation_count, summary, created_at";
const INSIGHT_COLUMNS =
  "id, analysis_run_id, entity_type, entity_id, category, severity, title, summary, confidence, evidence, status, reviewed_at, created_at, expires_at, superseded_at, superseded_by_run_id";
const RECOMMENDATION_COLUMNS =
  "id, analysis_run_id, insight_id, entity_type, entity_id, recommendation_type, priority, title, description, suggested_action, action_target, confidence, status, reviewed_at, created_at";

export async function getAIBrainOverview(): Promise<AIBrainOverview> {
  const { data, error } = await supabase.rpc("ai_brain_overview");
  if (error) throw error;
  return data as unknown as AIBrainOverview;
}

export async function getAIInsights(options: {
  status?: AIInsightStatus | "all";
  entityType?: string;
  entityId?: string;
  limit?: number;
} = {}): Promise<AIInsight[]> {
  let query = supabase
    .from("ai_insights")
    .select(INSIGHT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.status && options.status !== "all") query = query.eq("status", options.status);
  if (options.entityType) query = query.eq("entity_type", options.entityType);
  if (options.entityId) query = query.eq("entity_id", options.entityId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AIInsight[];
}

export async function getAIRecommendations(options: {
  status?: AIRecommendationStatus | "all";
  entityType?: string;
  entityId?: string;
  limit?: number;
} = {}): Promise<AIRecommendation[]> {
  let query = supabase
    .from("ai_recommendations")
    .select(RECOMMENDATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.status && options.status !== "all") query = query.eq("status", options.status);
  if (options.entityType) query = query.eq("entity_type", options.entityType);
  if (options.entityId) query = query.eq("entity_id", options.entityId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AIRecommendation[];
}

export async function getAnalysisRuns(options: {
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<AIAnalysisRun[]> {
  const limit = Math.min(options.limit ?? 25, 100);
  const offset = options.offset ?? 0;
  let query = supabase
    .from("ai_analysis_runs")
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (options.entityType) query = query.eq("entity_type", options.entityType);
  if (options.entityId) query = query.eq("entity_id", options.entityId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AIAnalysisRun[];
}

export async function getAnalysisRun(runId: string): Promise<{
  run: AIAnalysisRun | null;
  insights: AIInsight[];
  recommendations: AIRecommendation[];
}> {
  const [run, insights, recommendations] = await Promise.all([
    supabase.from("ai_analysis_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle(),
    supabase.from("ai_insights").select(INSIGHT_COLUMNS).eq("analysis_run_id", runId),
    supabase.from("ai_recommendations").select(RECOMMENDATION_COLUMNS).eq("analysis_run_id", runId),
  ]);
  if (run.error) throw run.error;
  return {
    run: (run.data ?? null) as unknown as AIAnalysisRun | null,
    insights: (insights.data ?? []) as unknown as AIInsight[],
    recommendations: (recommendations.data ?? []) as unknown as AIRecommendation[],
  };
}

export async function getAIBrainEvents(limit = 20): Promise<AIBrainEvent[]> {
  const { data, error } = await supabase
    .from("ai_brain_events")
    .select("id, event_type, run_id, insight_id, recommendation_id, message, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as AIBrainEvent[];
}

/* ---------------- Controlled review operations ---------------- */

export async function setInsightStatus(
  insightId: string,
  status: Extract<AIInsightStatus, "acknowledged" | "dismissed">,
): Promise<void> {
  const { error } = await supabase.rpc("ai_set_insight_status", {
    _insight_id: insightId,
    _status: status,
  });
  if (error) throw error;
}

export async function setRecommendationStatus(
  recommendationId: string,
  status: Extract<AIRecommendationStatus, "accepted" | "dismissed" | "executed">,
): Promise<void> {
  const { error } = await supabase.rpc("ai_set_recommendation_status", {
    _recommendation_id: recommendationId,
    _status: status,
  });
  if (error) throw error;
}

/* ---------------- System Analysis (deterministic, NOT AI) ---------------- */

/**
 * Deterministic signals computed from the authoritative attention feed.
 * They are always presented as "System Analysis" and never mixed with
 * provider-generated insights.
 */
export async function getSystemSignals(): Promise<SystemSignal[]> {
  const feed = await getAttentionFeed();
  const now = Date.now();

  const groups: {
    id: string;
    label: string;
    href: string;
    match: (category: string) => boolean;
  }[] = [
    { id: "verification", label: "Verification queue", href: "/orders/verification", match: (c) => c === "verification" },
    { id: "fulfillment", label: "Warehouse backlog", href: "/orders/fulfillment", match: (c) => c === "fulfillment" },
    { id: "shipping", label: "Shipments needing action", href: "/orders/shipments", match: (c) => c === "shipping" },
    { id: "delivery_exception", label: "Open delivery exceptions", href: "/orders/exceptions", match: (c) => c === "delivery_exception" },
    { id: "return", label: "Returns in progress", href: "/returns", match: (c) => c === "return" },
    { id: "inventory", label: "Inventory attention", href: "/inventory", match: (c) => c === "inventory" },
    { id: "procurement", label: "Procurement attention", href: "/procurement/purchase-orders", match: (c) => c === "procurement" },
  ];

  return groups
    .map((group) => {
      const rows = feed.filter((item) => group.match(item.category));
      const overdue = rows.filter(
        (item) => item.due_at && new Date(item.due_at).getTime() < now,
      ).length;
      const critical = rows.filter((item) => item.severity === "critical").length;
      const severity = critical > 0 ? "critical" : overdue > 0 ? "high" : rows.length ? "medium" : "info";
      return {
        id: group.id,
        label: group.label,
        severity,
        count: rows.length,
        detail:
          rows.length === 0
            ? "Clear"
            : `${rows.length} item(s)${overdue ? `, ${overdue} overdue` : ""}${critical ? `, ${critical} critical` : ""}`,
        href: group.href,
      } as SystemSignal;
    })
    .filter((signal) => signal.count > 0);
}
