/**
 * AI Brain server actions.
 *
 * Flow for every analysis:
 *   authenticate → re-check permission in the database → validate analysis type
 *   and entity → build authorised, minimal context → check provider
 *   availability → open a controlled run → call the provider → validate the
 *   structured output → store insights and recommendations through the
 *   controlled function.
 *
 * Nothing here writes to an authoritative commerce table. A failure only ever
 * marks the run failed with a sanitized message.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAnalysisDefinition } from "@/lib/ai/registry";
import type { AIProviderStatus } from "@/types/ai";

const requestInput = z.object({
  analysisType: z.string().min(1),
  entityId: z.string().uuid().nullable().optional(),
});

export interface RequestAnalysisResult {
  ok: boolean;
  runId: string | null;
  status: "completed" | "failed" | "unavailable";
  message: string;
  insightCount: number;
  recommendationCount: number;
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

async function assertCanRequest(supabase: unknown, userId: string) {
  const { data } = await (supabase as RpcClient).rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to request an AI analysis");
}

/** Provider errors collapse into a short operator-safe sentence. */
function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && error.message.length <= 300) return error.message;
  return fallback;
}

const INSTRUCTIONS: Record<string, string> = {
  operations_summary:
    "You are an operations analyst for a Bangladesh ecommerce business. Summarise the operational attention data, identify real patterns and priorities, and propose review actions a human operator can take. Never claim an action was performed.",
  order_review:
    "You are an order risk analyst for a Bangladesh cash-on-delivery ecommerce business. Assess the risk and operational completeness of this single order and propose review actions for a human operator. Never claim an action was performed.",
  customer_review:
    "You are a customer operations analyst. Assess this customer's operational behaviour (verification, delivery and return patterns) and propose review actions for a human operator. Never claim an action was performed.",
  inventory_review:
    "You are an inventory analyst. Assess stock health from the supplied authoritative signals and propose review actions for a human operator. Do not forecast demand. Never claim an action was performed.",
};

const BASE_INSTRUCTIONS =
  "Return only observations grounded in the supplied context. If the context shows nothing noteworthy, return an empty insights array and an empty recommendations array with a short summary. Do not invent identifiers. Every insight needs a unique 'key'; recommendations reference an insight through 'insight_key'.";

export const getAIProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AIProviderStatus> => {
    const { getAIProvider } = await import("@/lib/ai/provider.server");
    const health = getAIProvider().healthCheck();

    const client = context.supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => { limit: (n: number) => PromiseLike<{ data: { completed_at: string }[] | null }> };
          };
        };
      };
    };
    const { data } = await client
      .from("ai_analysis_runs")
      .select("completed_at")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1);

    return {
      connected: health.connected,
      provider: health.provider,
      model: health.model,
      message: health.message,
      lastSuccessfulAnalysisAt: data?.[0]?.completed_at ?? null,
    };
  });

export const requestAIAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => requestInput.parse(data))
  .handler(async ({ data, context }): Promise<RequestAnalysisResult> => {
    await assertCanRequest(context.supabase, context.userId);

    const definition = getAnalysisDefinition(data.analysisType);
    if (!definition || !definition.enabled) {
      throw new Error("This analysis type is not available");
    }
    const entityId = data.entityId ?? null;
    if (definition.requiresEntity && !entityId) {
      throw new Error("This analysis needs a target record");
    }

    const rpc = context.supabase as unknown as RpcClient;
    const { getAIProvider, AIProviderUnavailableError } = await import("@/lib/ai/provider.server");
    const provider = getAIProvider();
    const health = provider.healthCheck();

    // Context is built with the caller's own client, so RLS decides scope.
    const { buildContext } = await import("@/lib/ai/context.server");
    const authedClient = context.supabase as unknown as Parameters<typeof buildContext>[1];
    const built = await buildContext(definition.contextBuilder, authedClient, entityId);

    const started = await rpc.rpc("ai_start_analysis_run", {
      _analysis_type: definition.type,
      _entity_type: definition.entityType,
      _entity_id: entityId,
      _provider: health.connected ? health.provider : null,
      _model: health.connected ? health.model : null,
      _source: "ai_provider",
      _context_summary: built.summary,
    });
    if (started.error) throw new Error(safeMessage(started.error, "Could not start the analysis"));
    const run = started.data as { id: string };

    const failRun = async (message: string) => {
      await rpc.rpc("ai_fail_analysis_run", { _run_id: run.id, _error: message.slice(0, 500) });
    };

    if (!health.connected) {
      const message = "No AI provider is currently configured";
      await failRun(message);
      return {
        ok: false,
        runId: run.id,
        status: "unavailable",
        message,
        insightCount: 0,
        recommendationCount: 0,
      };
    }

    try {
      const raw = await provider.generateStructuredOutput({
        instructions: `${INSTRUCTIONS[definition.type] ?? INSTRUCTIONS["operations_summary"]} ${BASE_INSTRUCTIONS}`,
        context: built.data,
      });

      const { normalizeAiResult } = await import("@/lib/ai/output-schema");
      const payload = normalizeAiResult(raw, definition.entityType, entityId);

      const completed = await rpc.rpc("ai_complete_analysis_run", {
        _run_id: run.id,
        _payload: JSON.parse(JSON.stringify(payload)) as unknown,
      });
      if (completed.error) throw new Error("Analysis output could not be stored");

      return {
        ok: true,
        runId: run.id,
        status: "completed",
        message: `Analysis completed with ${payload.insights.length} insight(s) and ${payload.recommendations.length} recommendation(s)`,
        insightCount: payload.insights.length,
        recommendationCount: payload.recommendations.length,
      };
    } catch (error) {
      const unavailable = error instanceof AIProviderUnavailableError;
      const message =
        error instanceof z.ZodError
          ? `AI provider returned output that failed validation (${error.issues
              .slice(0, 3)
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; ")})`
          : safeMessage(error, "The AI analysis could not be completed");
      await failRun(message);
      return {
        ok: false,
        runId: run.id,
        status: unavailable ? "unavailable" : "failed",
        message,
        insightCount: 0,
        recommendationCount: 0,
      };
    }
  });
