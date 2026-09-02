import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { setRecommendationStatus } from "@/lib/ai";
import {
  AI_PRIORITY_LABELS,
  AI_PRIORITY_TONE,
  type AIRecommendation,
} from "@/types/ai";

/**
 * Recommendations are suggestions only. Accepting one records a human
 * decision; the operator still performs the real work in the authoritative
 * module. AI Brain never executes a business action.
 */
export function AIRecommendationList({
  recommendations,
  isLoading,
  invalidateKeys,
}: {
  recommendations: AIRecommendation[];
  isLoading?: boolean;
  invalidateKeys?: unknown[][];
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "accepted" | "dismissed" | "executed" }) =>
      setRecommendationStatus(id, status),
    onSuccess: () => {
      toast.success("Recommendation updated");
      for (const key of invalidateKeys ?? [["ai-recommendations"], ["ai-overview"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error: Error) => toast.error(error.message || "Could not update the recommendation"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading recommendations…</p>;
  if (recommendations.length === 0) {
    return (
      <EmptyState
        title="No recommendations"
        description="Recommendations appear after an analysis. They are never applied automatically."
        compact
      />
    );
  }

  return (
    <div className="space-y-2">
      {recommendations.map((rec) => (
        <article key={rec.id} className="rounded border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={AI_PRIORITY_TONE[rec.priority]}>
                  {AI_PRIORITY_LABELS[rec.priority]}
                </StatusBadge>
                <StatusBadge tone="neutral">{rec.recommendation_type}</StatusBadge>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Suggestion · confidence {Math.round(rec.confidence * 100)}%
                </span>
                {rec.status !== "pending" ? (
                  <StatusBadge tone="neutral">{rec.status}</StatusBadge>
                ) : null}
              </div>
              <h3 className="mt-1.5 text-sm font-semibold">{rec.title}</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">{rec.description}</p>
              {rec.suggested_action ? (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Suggested action: <span className="font-medium text-foreground">{rec.suggested_action}</span>
                  {rec.action_target ? ` · ${rec.action_target}` : ""}
                </p>
              ) : null}
            </div>
            {rec.status === "pending" ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: rec.id, status: "accepted" })}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: rec.id, status: "dismissed" })}
                >
                  Dismiss
                </Button>
              </div>
            ) : rec.status === "accepted" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ id: rec.id, status: "executed" })}
              >
                Mark handled
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
