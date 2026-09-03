import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ExceptionQuickView } from "@/components/shipping/ExceptionQuickView";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { useProfile } from "@/hooks/use-profile";
import { formatMoney } from "@/lib/currency";
import { assignOperationalWork, releaseOperationalWork } from "@/lib/operations";
import { invalidateShippingSurfaces } from "@/lib/shipping-cache";
import {
  EXCEPTION_SORTS,
  EXCEPTION_SORT_LABELS,
  getExceptionsConsole,
} from "@/lib/exception-console";
import type { ExceptionConsoleFilters, ExceptionSort } from "@/lib/exception-console";
import {
  EXCEPTION_STATUSES,
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_STATUS_TONE,
  EXCEPTION_TYPES,
  EXCEPTION_TYPE_LABELS,
} from "@/types/returns";
import type { ShipmentExceptionStatus, ShipmentExceptionType } from "@/types/returns";

const TITLE = "Delivery Exceptions · Commerce Operations";
const DESCRIPTION =
  "Own, investigate and close failed deliveries, holds, COD problems and pickup failures.";

export const Route = createFileRoute("/_authenticated/orders/exceptions")({
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
  component: Page,
});

const PAGE_SIZES = [25, 50, 100, 200];
const SAVED_VIEW_KEY = "exception-desk-view";

interface ViewPreset {
  key: string;
  label: string;
  filters: ExceptionConsoleFilters;
}

const VIEWS: ViewPreset[] = [
  { key: "open", label: "Needs attention", filters: { status: "open", sort: "oldest_unresolved" } },
  { key: "mine", label: "Assigned to me", filters: { status: "open", sort: "oldest_assigned" } },
  { key: "unassigned", label: "Unassigned", filters: { status: "open", sort: "priority" } },
  {
    key: "cod",
    label: "COD discrepancies",
    filters: { status: "open", has_discrepancy: true, sort: "priority" },
  },
  { key: "all", label: "All exceptions", filters: { status: "all", sort: "newest" } },
];

function Page() {
  const { canManage } = useCommercePermissions();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();

  const [viewKey, setViewKey] = useState("open");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ShipmentExceptionStatus | "open" | "all">("open");
  const [type, setType] = useState<ShipmentExceptionType | "all">("all");
  const [sort, setSort] = useState<ExceptionSort>("oldest_unresolved");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [quickId, setQuickId] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(SAVED_VIEW_KEY);
    if (saved && VIEWS.some((v) => v.key === saved)) applyView(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyView(key: string) {
    const view = VIEWS.find((v) => v.key === key);
    if (!view) return;
    setViewKey(key);
    window.localStorage.setItem(SAVED_VIEW_KEY, key);
    setStatus((view.filters.status as ShipmentExceptionStatus | "open" | "all") ?? "open");
    setType("all");
    setSort(view.filters.sort ?? "oldest_unresolved");
    setPage(1);
  }

  const activeView = VIEWS.find((v) => v.key === viewKey) ?? VIEWS[0]!;

  const filters: ExceptionConsoleFilters = useMemo(
    () => ({
      ...activeView.filters,
      page,
      page_size: pageSize,
      sort,
      status,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(type !== "all" ? { exception_type: type } : {}),
      ...(viewKey === "mine" ? { assigned_to: "me" } : {}),
      ...(viewKey === "unassigned" ? { assigned_to: "unassigned" } : {}),
    }),
    [activeView, page, pageSize, sort, status, search, type, viewKey],
  );

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ["exceptions-console", filters],
    queryFn: () => getExceptionsConsole(filters),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const claim = useMutation({
    mutationFn: async (exceptionId: string) => {
      if (!profile?.id) throw new Error("Your profile is still loading.");
      await assignOperationalWork({
        sourceType: "shipment_exception",
        sourceId: exceptionId,
        assignedTo: profile.id,
      });
    },
    onSuccess: () => {
      toast.success("Exception assigned to you.");
      invalidateShippingSurfaces(queryClient);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const release = useMutation({
    mutationFn: (exceptionId: string) =>
      releaseOperationalWork("shipment_exception", exceptionId),
    onSuccess: () => {
      toast.success("Exception released.");
      invalidateShippingSurfaces(queryClient);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <>
      <PageHeader title="Delivery exceptions" description={DESCRIPTION} />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {VIEWS.map((view) => (
          <Button
            key={view.key}
            size="sm"
            variant={view.key === viewKey ? "default" : "outline"}
            onClick={() => applyView(view.key)}
          >
            {view.label}
          </Button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-80 text-[13px]"
          placeholder="Order, customer, phone, shipment or tracking"
          value={search}
          onChange={(event) => resetPage(setSearch)(event.target.value)}
          aria-label="Search exceptions"
        />
        <Select value={status} onValueChange={(v) => resetPage(setStatus)(v as typeof status)}>
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Needs attention</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {EXCEPTION_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {EXCEPTION_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={type}
          onValueChange={(v) => resetPage(setType)(v as ShipmentExceptionType | "all")}
        >
          <SelectTrigger className="h-8 w-52 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All exception types</SelectItem>
            {EXCEPTION_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {EXCEPTION_TYPE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => resetPage(setSort)(v as ExceptionSort)}>
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXCEPTION_SORTS.map((key) => (
              <SelectItem key={key} value={key}>
                {EXCEPTION_SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <EmptyState
          icon={AlertTriangle}
          title="Exceptions could not be loaded"
          description={(error as Error).message}
        />
      ) : isPending ? (
        <LoadingState rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No delivery exceptions in this view"
          description="Courier problems appear here automatically as soon as they are reported."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left">Incident</th>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Shipment</th>
                <th className="px-3 py-2 text-left">Owner</th>
                <th className="px-3 py-2 text-left">Age</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onClick={() => setQuickId(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setQuickId(row.id);
                    }
                  }}
                  className="cursor-pointer border-b border-border align-top last:border-0 hover:bg-accent/40 focus:bg-accent/40 focus:outline-none"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{EXCEPTION_TYPE_LABELS[row.exception_type]}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {row.courier_reason ?? row.reason ?? "No reason reported"}
                    </div>
                    {row.collected_amount != null && (
                      <div className="text-[12px] text-muted-foreground">
                        Collected {formatMoney(Number(row.collected_amount))}
                      </div>
                    )}
                    {row.open_discrepancies > 0 && (
                      <div className="text-[12px] text-destructive">
                        {row.open_discrepancies} settlement discrepancy(ies)
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.order_id ? (
                      <Link
                        to="/orders/$id"
                        params={{ id: row.order_id }}
                        className="font-medium text-primary hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.order_number ?? "Order"}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <div className="text-[12px] text-muted-foreground">
                      {row.customer_name} · {row.customer_phone}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.shipment_id ? (
                      <Link
                        to="/orders/shipments/$id"
                        params={{ id: row.shipment_id }}
                        className="hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.shipment_number}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <div className="text-[12px] text-muted-foreground">
                      {row.provider_name ?? "No courier"} · {row.tracking_number ?? "No tracking"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {row.assigned_to ? (
                      <>
                        {row.assigned_name ?? "Unknown"}
                        {row.assigned_is_mine ? " (you)" : ""}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {Math.round(row.age_hours)}h
                    <div>{row.source === "courier" ? "From courier" : "Manual"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={EXCEPTION_STATUS_TONE[row.status]}>
                      {EXCEPTION_STATUS_LABELS[row.status]}
                    </StatusBadge>
                    {row.resolution_note && (
                      <div className="mt-1 max-w-[220px] text-[12px] text-muted-foreground">
                        {row.resolution_note}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {canManage && !row.assigned_to && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={claim.isPending}
                          onClick={() => claim.mutate(row.id)}
                        >
                          Claim
                        </Button>
                      )}
                      {canManage && row.assigned_is_mine && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={release.isPending}
                          onClick={() => release.mutate(row.id)}
                        >
                          Release
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setQuickId(row.id)}>
                        Open
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
        <span>
          {total} exception(s) · page {page} of {pageCount}
          {isFetching ? " · refreshing…" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Select value={String(pageSize)} onValueChange={(v) => resetPage(setPageSize)(Number(v))}>
            <SelectTrigger className="h-8 w-28 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {quickId && (
        <ExceptionQuickView
          exceptionId={quickId}
          onOpenChange={(open) => !open && setQuickId(null)}
        />
      )}
    </>
  );
}
