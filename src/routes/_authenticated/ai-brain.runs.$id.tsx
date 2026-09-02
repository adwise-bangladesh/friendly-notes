import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AIInsightList } from "@/components/ai/AIInsightList";
import { AIRecommendationList } from "@/components/ai/AIRecommendationList";
import { getAnalysisRun } from "@/lib/ai";
import { AI_RUN_STATUS_TONE } from "@/types/ai";
import { AI_ANALYSIS_REGISTRY } from "@/lib/ai/registry";

const TITLE = "AI Analysis Run · Commerce Operations";
const DESCRIPTION =
  "Full detail of a single AI Brain analysis run: status, provider, context shape, insights and recommendations.";

export const Route = createFileRoute("/_authenticated/ai-brain/runs/$id")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AIRunPage,
});

function AIRunPage() {
  const { id } = Route.useParams();
  const query = useQuery({ queryKey: ["ai-run", id], queryFn: () => getAnalysisRun(id) });

  if (query.isLoading) return <LoadingState rows={6} />;
  const run = query.data?.run;
  if (!run) return <p className="text-sm text-muted-foreground">Analysis run not found.</p>;

  return (
    <div className="space-y-5">
      <PageHeader
        title={AI_ANALYSIS_REGISTRY[run.analysis_type]?.label ?? run.analysis_type}
        description={run.summary ?? "No summary was produced for this run."}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link to="/ai-brain/history">Back to history</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Run detail</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-[13px] sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status</span>
            <StatusBadge tone={AI_RUN_STATUS_TONE[run.status]}>{run.status}</StatusBadge>
          </div>
          <p>
            <span className="text-muted-foreground">Source: </span>
            {run.source === "system" ? "System (rule-based)" : (run.provider ?? "AI provider")}
            {run.model ? ` · ${run.model}` : ""}
          </p>
          <p>
            <span className="text-muted-foreground">Requested: </span>
            {new Date(run.created_at).toLocaleString()}
          </p>
          <p>
            <span className="text-muted-foreground">Duration: </span>
            {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Entity: </span>
            {run.entity_type}
            {run.entity_id ? ` · ${run.entity_id}` : ""}
          </p>
          {run.error_message ? (
            <p className="text-destructive">
              <span className="text-muted-foreground">Failure: </span>
              {run.error_message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Insights</h2>
        <AIInsightList
          insights={query.data?.insights ?? []}
          invalidateKeys={[["ai-run", id], ["ai-overview"]]}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recommendations</h2>
        <AIRecommendationList
          recommendations={query.data?.recommendations ?? []}
          invalidateKeys={[["ai-run", id], ["ai-overview"]]}
        />
      </section>
    </div>
  );
}
