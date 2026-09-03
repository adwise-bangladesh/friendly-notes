import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, Ban, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { AttentionTable } from "@/components/operations/AttentionTable";
import { AttentionDrawer } from "@/components/operations/AttentionDrawer";
import { OperationalAlertsPanel } from "@/components/operations/OperationalAlertsPanel";

import {
  computeCounters,
  filterAndSortAttention,
  getAttentionFeed,
  getRecentOperationalActivity,
  type AttentionSort,
} from "@/lib/operations";
import {
  OPERATION_CATEGORIES,
  OPERATION_CATEGORY_LABELS,
  OPERATION_SEVERITIES,
  OPERATION_SEVERITY_LABELS,
} from "@/types/operations";
import type {
  OperationAttention,
  OperationCategory,
  OperationSeverity,
} from "@/types/operations";

const TITLE = "Operations Command Center · Commerce Operations";
const DESCRIPTION =
  "One prioritised view of everything that needs attention across verification, warehouse, shipping, returns, inventory and procurement.";

export const Route = createFileRoute("/_authenticated/operations/")({
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
  component: OperationsPage,
});

function Counter({
  label,
  value,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded border px-3 py-2.5 text-left transition-colors ${
        active ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"
      }`}
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-base font-semibold tabular-nums">{value}</p>
      </div>
    </button>
  );
}

function OperationsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<OperationCategory | "all">("all");
  const [severity, setSeverity] = useState<OperationSeverity | "all">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<AttentionSort>("severity");
  const [selected, setSelected] = useState<OperationAttention | null>(null);

  const feed = useQuery({
    queryKey: ["operations", "attention"],
    queryFn: getAttentionFeed,
    staleTime: 30_000,
  });

  const activity = useQuery({
    queryKey: ["operations", "activity"],
    queryFn: () => getRecentOperationalActivity(12),
    staleTime: 30_000,
  });

  const items = useMemo(() => feed.data ?? [], [feed.data]);
  const counters = useMemo(() => computeCounters(items), [items]);
  const rows = useMemo(
    () =>
      filterAndSortAttention(items, {
        search,
        category,
        severity,
        overdueOnly,
        sort,
      }),
    [items, search, category, severity, overdueOnly, sort],
  );

  // Keep the drawer in sync with refreshed feed data.
  const selectedLive = selected ? (items.find((i) => i.id === selected.id) ?? selected) : null;

  return (
    <div>
      <PageHeader
        title="Operations Command Center"
        description="Derived from live operational records — nothing here is stored or duplicated."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/operations/my-work">My Work</Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter
          label="Needs attention"
          value={counters.total}
          icon={Activity}
          active={severity === "all" && !overdueOnly}
          onClick={() => {
            setSeverity("all");
            setOverdueOnly(false);
          }}
        />
        <Counter
          label="Critical"
          value={counters.critical}
          icon={AlertTriangle}
          active={severity === "critical"}
          onClick={() => setSeverity(severity === "critical" ? "all" : "critical")}
        />
        <Counter
          label="Overdue"
          value={counters.overdue}
          icon={Clock}
          active={overdueOnly}
          onClick={() => setOverdueOnly(!overdueOnly)}
        />
        <Counter label="Blocked" value={counters.blocked} icon={Ban} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order, item or reason"
          className="h-8 w-56"
        />
        <Select value={category} onValueChange={(v) => setCategory(v as OperationCategory | "all")}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="Area" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {OPERATION_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {OPERATION_CATEGORY_LABELS[c]} ({counters.byCategory[c]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={(v) => setSeverity(v as OperationSeverity | "all")}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {OPERATION_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {OPERATION_SEVERITY_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as AttentionSort)}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="severity">Severity first</SelectItem>
            <SelectItem value="due">Due date</SelectItem>
            <SelectItem value="created">Oldest first</SelectItem>
            <SelectItem value="category">Area</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => void feed.refetch()}>
          Refresh
        </Button>
      </div>

      <div className="rounded border border-border">
        <AttentionTable
          items={rows}
          isLoading={feed.isLoading}
          onSelect={(item) => setSelected(item)}
        />
      </div>

      <div className="mt-6 rounded border border-border">
        <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recent operational activity
        </div>
        {activity.isLoading ? (
          <LoadingState rows={3} />
        ) : (
          <ul className="divide-y divide-border text-[12.5px]">
            {(activity.data ?? []).map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{entry.category}</span> ·{" "}
                  {entry.reference} · {entry.message ?? entry.event_type.replace(/_/g, " ")}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString()}
                  {entry.actor_name ? ` · ${entry.actor_name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AttentionDrawer item={selectedLive} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
