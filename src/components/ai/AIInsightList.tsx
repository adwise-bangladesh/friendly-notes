import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { setInsightStatus } from "@/lib/ai";
import {
  AI_SEVERITY_LABELS,
  AI_SEVERITY_TONE,
  insightFreshness,
  type AIInsight,
} from "@/types/ai";

const FRESHNESS: Record<string, { label: string; tone: "success" | "warning" | "neutral"; hint: string }> = {
  current: { label: "Current", tone: "success", hint: "Based on the latest analysis for this scope." },
  superseded: {
    label: "Superseded",
    tone: "warning",
    hint: "A newer analysis replaced this observation — do not act on it.",
  },
  expired: {
    label: "Expired",
    tone: "warning",
    hint: "This observation is past its validity window — re-run the analysis.",
  },
  reviewed: { label: "Reviewed", tone: "neutral", hint: "Already acknowledged or dismissed." },
};

/**
 * Insights are observations. Acknowledging or dismissing one is a review
 * decision only — it never touches an order, shipment or stock record.
 */
export function AIInsightList({
  insights,
  isLoading,
  invalidateKeys,
}: {
  insights: AIInsight[];
  isLoading?: boolean;
  invalidateKeys?: unknown[][];
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "acknowledged" | "dismissed" }) =>
      setInsightStatus(id, status),
    onSuccess: (_data, variables) => {
      toast.success(variables.status === "acknowledged" ? "Insight acknowledged" : "Insight dismissed");
      for (const key of invalidateKeys ?? [["ai-insights"], ["ai-overview"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error: Error) => toast.error(error.message || "Could not update the insight"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading insights…</p>;
  if (insights.length === 0) {
    return (
      <EmptyState
        title="No AI insights"
        description="Run an analysis to generate observations. Insights are suggestions for a human to review."
        compact
      />
    );
  }

  return (
    <div className="space-y-2">
      {insights.map((insight) => (
        <article key={insight.id} className="rounded border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={AI_SEVERITY_TONE[insight.severity]}>
                  {AI_SEVERITY_LABELS[insight.severity]}
                </StatusBadge>
                <StatusBadge tone="neutral">{insight.category}</StatusBadge>
                {(() => {
                  const f = FRESHNESS[insightFreshness(insight)]!;
                  return (
                    <span title={f.hint}>
                      <StatusBadge tone={f.tone}>{f.label}</StatusBadge>
                    </span>
                  );
                })()}
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  AI generated · confidence {Math.round(insight.confidence * 100)}%
                </span>
                {insight.status !== "active" ? (
                  <StatusBadge tone="neutral">{insight.status}</StatusBadge>
                ) : null}
              </div>
              <h3 className="mt-1.5 text-sm font-semibold">{insight.title}</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">{insight.summary}</p>
              {Array.isArray(insight.evidence) && insight.evidence.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {(insight.evidence as { label: string; value: string }[]).map((item, index) => (
                    <li key={`${insight.id}-${index}`} className="text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground">{item.label}:</span> {item.value}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {insight.status === "active" ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: insight.id, status: "acknowledged" })}
                >
                  Acknowledge
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: insight.id, status: "dismissed" })}
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
