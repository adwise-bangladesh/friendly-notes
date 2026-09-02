import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AIInsightList } from "./AIInsightList";
import { AIRecommendationList } from "./AIRecommendationList";
import { RunAnalysisButton } from "./RunAnalysisButton";
import { getAIInsights, getAIRecommendations } from "@/lib/ai";
import type { AIAnalysisType } from "@/types/ai";

/**
 * AI section for an authoritative record (order, customer, …).
 * Read-only intelligence: insights and suggestions, never actions.
 */
export function AIEntityPanel({
  entityType,
  entityId,
  analysisType,
  title = "AI Brain",
}: {
  entityType: string;
  entityId: string;
  analysisType: AIAnalysisType;
  title?: string;
}) {
  const insightsKey = ["ai-insights", entityType, entityId];
  const recsKey = ["ai-recommendations", entityType, entityId];

  const insights = useQuery({
    queryKey: insightsKey,
    queryFn: () => getAIInsights({ entityType, entityId, status: "all", limit: 20 }),
  });
  const recommendations = useQuery({
    queryKey: recsKey,
    queryFn: () => getAIRecommendations({ entityType, entityId, status: "all", limit: 20 }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Suggestions only — nothing here changes this record.
          </p>
        </div>
        <RunAnalysisButton
          analysisType={analysisType}
          entityId={entityId}
          invalidateKeys={[insightsKey, recsKey, ["ai-overview"], ["ai-runs"]]}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <AIInsightList
          insights={insights.data ?? []}
          isLoading={insights.isLoading}
          invalidateKeys={[insightsKey, ["ai-overview"]]}
        />
        <AIRecommendationList
          recommendations={recommendations.data ?? []}
          isLoading={recommendations.isLoading}
          invalidateKeys={[recsKey, ["ai-overview"]]}
        />
      </CardContent>
    </Card>
  );
}
