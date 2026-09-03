/**
 * Recent operational failures.
 *
 * Reads the bounded, paginated `list_operational_diagnostics` projection — the
 * database authorises the caller and returns safe fields only (no credentials,
 * no provider payloads). Selecting a row loads its correlation trail so an
 * operator can follow one failure across the worker run and the courier calls
 * it produced.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { StatusTone } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  ERROR_CATEGORY_LABELS,
  FAILURE_STAGE_LABELS,
  SUBSYSTEM_LABELS,
  getDiagnosticTrail,
  listDiagnostics,
} from "@/lib/observability";
import type { DiagnosticRow } from "@/lib/observability";

const PAGE_SIZE = 15;

const SEVERITY_TONE: Record<string, StatusTone> = {
  critical: "danger",
  error: "danger",
  warning: "warning",
  info: "info",
};

function when(value: string): string {
  return new Date(value).toLocaleString();
}

function TrailSheet({
  correlationId,
  onClose,
}: {
  correlationId: string | null;
  onClose: () => void;
}) {
  const trail = useQuery({
    queryKey: ["diagnostic-trail", correlationId],
    queryFn: () => getDiagnosticTrail(correlationId as string),
    enabled: Boolean(correlationId),
  });

  return (
    <Sheet open={Boolean(correlationId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Failure trail</SheetTitle>
          <SheetDescription className="font-mono text-[12px]">{correlationId}</SheetDescription>
        </SheetHeader>

        {trail.isLoading ? <LoadingState label="Loading the trail…" /> : null}
        {trail.error ? (
          <p className="mt-4 text-[12.5px] text-destructive">
            {trail.error instanceof Error ? trail.error.message : "Could not load the trail"}
          </p>
        ) : null}

        {trail.data ? (
          <div className="mt-4 space-y-5 text-[12.5px]">
            <section>
              <p className="mb-2 font-medium">Worker runs</p>
              {trail.data.worker_runs.length === 0 ? (
                <p className="text-muted-foreground">No worker run carried this correlation id.</p>
              ) : (
                trail.data.worker_runs.map((run) => (
                  <div key={run.id} className="mb-2 rounded-lg border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={run.status === "failed" ? "danger" : "success"}>
                        {run.status}
                      </StatusBadge>
                      <span className="font-medium">{run.worker}</span>
                      <span className="text-muted-foreground">{run.trigger_source}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {when(run.started_at)} · {run.duration_ms ?? "—"} ms · claimed {run.claimed} ·
                      processed {run.processed} · succeeded {run.succeeded} · failed {run.failed} ·
                      skipped {run.skipped}
                      {run.error_class ? ` · ${run.error_class}` : ""}
                    </p>
                  </div>
                ))
              )}
            </section>

            <section>
              <p className="mb-2 font-medium">Diagnostics</p>
              {trail.data.diagnostics.length === 0 ? (
                <p className="text-muted-foreground">No diagnostics recorded.</p>
              ) : (
                trail.data.diagnostics.map((row) => (
                  <div key={row.id} className="mb-2 rounded-lg border border-border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={SEVERITY_TONE[row.severity] ?? "neutral"}>
                        {row.severity}
                      </StatusBadge>
                      <span className="font-medium">
                        {SUBSYSTEM_LABELS[row.subsystem] ?? row.subsystem} · {row.operation}
                      </span>
                    </div>
                    <p className="mt-1">{row.message}</p>
                    <p className="mt-1 text-muted-foreground">
                      {when(row.occurred_at)} ·{" "}
                      {ERROR_CATEGORY_LABELS[row.error_category] ?? row.error_category}
                      {row.failure_stage
                        ? ` · ${FAILURE_STAGE_LABELS[row.failure_stage] ?? row.failure_stage}`
                        : ""}
                      {row.retryable ? " · retryable" : ""}
                    </p>
                  </div>
                ))
              )}
            </section>

            <section>
              <p className="mb-2 font-medium">Courier API calls</p>
              {trail.data.courier_api_calls.length === 0 ? (
                <p className="text-muted-foreground">No provider calls in this trail.</p>
              ) : (
                trail.data.courier_api_calls.map((call) => (
                  <div key={call.id} className="mb-2 rounded-lg border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={call.succeeded ? "success" : "danger"}>
                        {call.succeeded ? "ok" : "failed"}
                      </StatusBadge>
                      <span className="font-medium">{call.operation}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {when(call.created_at)}
                      {call.duration_ms == null ? "" : ` · ${call.duration_ms} ms`}
                      {call.status_code == null ? "" : ` · HTTP ${call.status_code}`}
                      {call.error_category ? ` · ${call.error_category}` : ""}
                    </p>
                    {call.safe_message ? <p className="mt-1">{call.safe_message}</p> : null}
                  </div>
                ))
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function DiagnosticsPanel() {
  const [severity, setSeverity] = useState("all");
  const [subsystem, setSubsystem] = useState("all");
  const [sinceHours, setSinceHours] = useState("168");
  const [page, setPage] = useState(0);
  const [trailFor, setTrailFor] = useState<string | null>(null);

  const diagnostics = useQuery({
    queryKey: ["operational-diagnostics", severity, subsystem, sinceHours, page],
    queryFn: () =>
      listDiagnostics({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sinceHours: Number(sinceHours),
        ...(severity === "all" ? {} : { severity }),
        ...(subsystem === "all" ? {} : { subsystem }),
      }),
    refetchInterval: 60_000,
  });

  const rows: DiagnosticRow[] = diagnostics.data?.rows ?? [];
  const total = diagnostics.data?.total ?? 0;

  return (
    <section className="mb-4 rounded-xl border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[13.5px] font-semibold">Recent operational failures</h2>
          <span className="text-[12px] text-muted-foreground">{total} in range</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={severity}
            onValueChange={(v) => {
              setSeverity(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-[140px] text-[12.5px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={subsystem}
            onValueChange={(v) => {
              setSubsystem(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-[160px] text-[12.5px]">
              <SelectValue placeholder="Subsystem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subsystems</SelectItem>
              {Object.entries(SUBSYSTEM_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sinceHours}
            onValueChange={(v) => {
              setSinceHours(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="h-8 w-[130px] text-[12.5px]">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="72">Last 3 days</SelectItem>
              <SelectItem value="168">Last 7 days</SelectItem>
              <SelectItem value="720">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void diagnostics.refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {diagnostics.isLoading ? <LoadingState label="Loading diagnostics…" /> : null}
      {diagnostics.error ? (
        <p className="text-[12.5px] text-destructive">
          {diagnostics.error instanceof Error
            ? diagnostics.error.message
            : "Could not load diagnostics"}
        </p>
      ) : null}

      {!diagnostics.isLoading && !diagnostics.error && rows.length === 0 ? (
        <EmptyState
          title="No failures recorded"
          description="Nothing failed in this time range. Widen the range to see older diagnostics."
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={SEVERITY_TONE[row.severity] ?? "neutral"}>
                      {row.severity}
                    </StatusBadge>
                    <span className="text-[13px] font-medium">
                      {SUBSYSTEM_LABELS[row.subsystem] ?? row.subsystem} · {row.operation}
                    </span>
                    <StatusBadge tone="neutral">
                      {ERROR_CATEGORY_LABELS[row.error_category] ?? row.error_category}
                    </StatusBadge>
                    {row.retryable ? <StatusBadge tone="info">Retryable</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-[12.5px]">{row.message}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {when(row.occurred_at)}
                    {row.failure_stage
                      ? ` · ${FAILURE_STAGE_LABELS[row.failure_stage] ?? row.failure_stage}`
                      : ""}
                    {row.provider_code ? ` · ${row.provider_code}` : ""}
                    {row.entity_type ? ` · ${row.entity_type}` : ""}
                    {row.duration_ms == null ? "" : ` · ${row.duration_ms} ms`}
                  </p>
                </div>
                {row.correlation_id ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTrailFor(row.correlation_id)}
                  >
                    <Search className="mr-1.5 h-3.5 w-3.5" /> Trail
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {total > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between text-[12.5px]">
          <span className="text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      <TrailSheet correlationId={trailFor} onClose={() => setTrailFor(null)} />
    </section>
  );
}
