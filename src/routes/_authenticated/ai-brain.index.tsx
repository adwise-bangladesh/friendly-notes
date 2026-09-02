import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, CheckCircle2, AlertTriangle, Activity } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AIInsightList } from "@/components/ai/AIInsightList";
import { AIRecommendationList } from "@/components/ai/AIRecommendationList";
import { SystemAnalysisPanel } from "@/components/ai/SystemAnalysisPanel";
import { RunAnalysisButton } from "@/components/ai/RunAnalysisButton";
import {
  getAIBrainOverview,
  getAIInsights,
  getAIRecommendations,
  getSystemSignals,
} from "@/lib/ai";
import { getAIProviderStatus } from "@/lib/ai.functions";
import { ENABLED_ANALYSES } from "@/lib/ai/registry";

const TITLE = "AI Brain · Commerce Operations";
const DESCRIPTION =
  "Provider-neutral intelligence layer: deterministic system analysis plus AI insights and recommendations that a human reviews before acting.";

export const Route = createFileRoute("/_authenticated/ai-brain/")({
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
  component: AIBrainPage,
});

function Stat({ label, value, icon: Icon }: { label: string; value: number | string; icon: typeof Brain }) {
  return (
    <div className="flex items-center gap-3 rounded border border-border px-3 py-2.5">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-base font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function AIBrainPage() {
  const providerStatusFn = useServerFn(getAIProviderStatus);

  const overview = useQuery({ queryKey: ["ai-overview"], queryFn: getAIBrainOverview });
  const provider = useQuery({ queryKey: ["ai-provider-status"], queryFn: () => providerStatusFn({}) });
  const signals = useQuery({ queryKey: ["ai-system-signals"], queryFn: getSystemSignals });
  const insights = useQuery({
    queryKey: ["ai-insights", "active"],
    queryFn: () => getAIInsights({ status: "active", limit: 50 }),
  });
  const recommendations = useQuery({
    queryKey: ["ai-recommendations", "pending"],
    queryFn: () => getAIRecommendations({ status: "pending", limit: 50 }),
  });

  const globalAnalyses = ENABLED_ANALYSES.filter((definition) => !definition.requiresEntity);

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Brain"
        description="An intelligence layer above the authoritative systems. It observes and suggests; it never changes orders, stock, shipments or finances."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/ai-brain/history">Analysis history</Link>
            </Button>
            {globalAnalyses.map((definition) => (
              <RunAnalysisButton
                key={definition.type}
                analysisType={definition.type}
                label={`Run ${definition.label}`}
              />
            ))}
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">AI provider</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={provider.data?.connected ? "success" : "warning"}>
            {provider.data?.connected ? "Configured" : "Not configured"}
          </StatusBadge>
          <span className="text-[13px] text-muted-foreground">
            {provider.data?.message ?? "Checking provider availability…"}
          </span>
          {provider.data?.model ? (
            <span className="text-[12px] text-muted-foreground">Model: {provider.data.model}</span>
          ) : null}
          {provider.data?.lastSuccessfulAnalysisAt ? (
            <span className="text-[12px] text-muted-foreground">
              Last successful analysis: {new Date(provider.data.lastSuccessfulAnalysisAt).toLocaleString()}
            </span>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active insights" value={overview.data?.active_insights ?? 0} icon={Brain} />
        <Stat label="Critical insights" value={overview.data?.critical_insights ?? 0} icon={AlertTriangle} />
        <Stat label="Pending suggestions" value={overview.data?.pending_recommendations ?? 0} icon={CheckCircle2} />
        <Stat label="Runs (7 days)" value={overview.data?.runs_last_7_days ?? 0} icon={Activity} />
      </div>

      <Tabs defaultValue="system">
        <TabsList>
          <TabsTrigger value="system">System Analysis</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        </TabsList>
        <TabsContent value="system" className="mt-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">System Analysis (rule-based, not AI)</CardTitle>
              <p className="text-[12px] text-muted-foreground">
                Computed directly from the authoritative attention feed. Always available, even without an AI provider.
              </p>
            </CardHeader>
            <CardContent>
              <SystemAnalysisPanel signals={signals.data ?? []} isLoading={signals.isLoading} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="insights" className="mt-3">
          <AIInsightList
            insights={insights.data ?? []}
            isLoading={insights.isLoading}
            invalidateKeys={[["ai-insights"], ["ai-overview"]]}
          />
        </TabsContent>
        <TabsContent value="recommendations" className="mt-3">
          <AIRecommendationList
            recommendations={recommendations.data ?? []}
            isLoading={recommendations.isLoading}
            invalidateKeys={[["ai-recommendations"], ["ai-overview"]]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
