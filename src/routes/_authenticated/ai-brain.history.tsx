import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { getAIBrainEvents, getAnalysisRuns } from "@/lib/ai";
import { AI_RUN_STATUS_TONE, type AIAnalysisRun } from "@/types/ai";
import { AI_ANALYSIS_REGISTRY } from "@/lib/ai/registry";

const TITLE = "AI Analysis History · Commerce Operations";
const DESCRIPTION =
  "Every AI Brain analysis run with its status, provider, duration and outcome, plus the append-only AI activity log.";

const PAGE_SIZE = 25;

export const Route = createFileRoute("/_authenticated/ai-brain/history")({
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
  component: AIHistoryPage,
});

function AIHistoryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);

  const runs = useQuery({
    queryKey: ["ai-runs", page],
    queryFn: () => getAnalysisRuns({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  });
  const events = useQuery({ queryKey: ["ai-events"], queryFn: () => getAIBrainEvents(20) });

  const columns: Column<AIAnalysisRun>[] = [
    {
      key: "type",
      header: "Analysis",
      render: (row) => (
        <div>
          <p className="font-medium">{AI_ANALYSIS_REGISTRY[row.analysis_type]?.label ?? row.analysis_type}</p>
          <p className="text-[11px] text-muted-foreground">{row.entity_type}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge tone={AI_RUN_STATUS_TONE[row.status]}>{row.status}</StatusBadge>,
    },
    {
      key: "source",
      header: "Source",
      render: (row) => (
        <span className="text-[12px] text-muted-foreground">
          {row.source === "system" ? "System" : (row.provider ?? "AI provider")}
          {row.model ? ` · ${row.model}` : ""}
        </span>
      ),
    },
    {
      key: "results",
      header: "Results",
      align: "right",
      render: (row) => (
        <span className="tabular-nums">
          {row.insight_count} insight(s) / {row.recommendation_count} suggestion(s)
        </span>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.duration_ms ? `${(row.duration_ms / 1000).toFixed(1)}s` : "—"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Requested",
      render: (row) => (
        <span className="text-[12px] text-muted-foreground">
          {new Date(row.created_at).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="AI analysis history" description={DESCRIPTION} />

      <DataTable
        columns={columns}
        rows={runs.data ?? []}
        rowKey={(row) => row.id}
        isLoading={runs.isLoading}
        emptyTitle="No analysis runs yet"
        emptyDescription="Run an analysis from the AI Brain page."
        onRowClick={(row) => void navigate({ to: "/ai-brain/runs/$id", params: { id: row.id } })}
      />

      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-[12px] text-muted-foreground">Page {page + 1}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={(runs.data?.length ?? 0) < PAGE_SIZE}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Recent AI activity</h2>
        <div className="space-y-1">
          {(events.data ?? []).map((event) => (
            <div key={event.id} className="flex items-center justify-between rounded border border-border px-3 py-1.5">
              <span className="text-[13px]">{event.message}</span>
              <span className="text-[11px] text-muted-foreground">
                {new Date(event.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {(events.data ?? []).length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No AI activity recorded yet.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
