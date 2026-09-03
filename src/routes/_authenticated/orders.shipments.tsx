import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ShipmentQuickView } from "@/components/shipping/ShipmentQuickView";
import { ShipmentBulkActions } from "@/components/shipping/ShipmentBulkActions";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import { getCourierProviders } from "@/lib/shipping";
import {
  BOOKING_STATE_LABELS,
  DELIVERY_GROUP_LABELS,
  SHIPMENT_SORTS,
  SHIPMENT_SORT_LABELS,
  getShipmentsConsole,
} from "@/lib/shipping-console";
import type {
  BookingState,
  DeliveryGroup,
  ShipmentConsoleFilters,
  ShipmentSort,
} from "@/lib/shipping-console";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONE,
} from "@/types/shipping";
import type { ShipmentStatus } from "@/types/shipping";

const TITLE = "Shipping Desk · Commerce Operations";
const DESCRIPTION =
  "Book couriers, chase delivery problems and reconcile COD across every shipment.";

export const Route = createFileRoute("/_authenticated/orders/shipments")({
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

interface ViewPreset {
  key: string;
  label: string;
  filters: ShipmentConsoleFilters;
}

const VIEWS: ViewPreset[] = [
  { key: "all", label: "All shipments", filters: { sort: "newest" } },
  {
    key: "to_book",
    label: "Needs booking",
    filters: { booking_state: "ready", sort: "booking_priority" },
  },
  {
    key: "booking_failed",
    label: "Booking failed",
    filters: { booking_state: "failed", sort: "booking_priority" },
  },
  {
    key: "recovery",
    label: "Unknown booking outcome",
    filters: { booking_state: "recovery_required", sort: "oldest_unresolved" },
  },
  {
    key: "stuck",
    label: "Stuck in transit (48h+)",
    filters: { status_group: "active", min_age_hours: 48, sort: "oldest_unresolved" },
  },
  {
    key: "exceptions",
    label: "With open exception",
    filters: { has_exception: true, sort: "oldest_unresolved" },
  },
  {
    key: "cod_mismatch",
    label: "COD mismatch",
    filters: { cod_mismatch: true, sort: "cod_desc" },
  },
  {
    key: "unsettled",
    label: "Delivered, not settled",
    filters: { delivery_group: "delivered", settlement: "unsettled", sort: "cod_desc" },
  },
];

const SAVED_VIEW_KEY = "shipping-desk-view";

function Page() {
  const { canManage } = useCommercePermissions();
  const [viewKey, setViewKey] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ShipmentStatus | "all">("all");
  const [bookingState, setBookingState] = useState<BookingState | "all">("all");
  const [deliveryGroup, setDeliveryGroup] = useState<DeliveryGroup | "all">("all");
  const [providerId, setProviderId] = useState("all");
  const [sort, setSort] = useState<ShipmentSort>("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<"assign" | "book" | null>(null);

  // Restore the operator's last view once, on mount.
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
    setStatus("all");
    setBookingState((view.filters.booking_state as BookingState) ?? "all");
    setDeliveryGroup((view.filters.delivery_group as DeliveryGroup) ?? "all");
    setSort(view.filters.sort ?? "newest");
    setPage(1);
    setSelected([]);
  }

  const activeView = VIEWS.find((v) => v.key === viewKey) ?? VIEWS[0]!;

  const filters: ShipmentConsoleFilters = useMemo(
    () => ({
      ...activeView.filters,
      page,
      page_size: pageSize,
      sort,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(bookingState !== "all" ? { booking_state: bookingState } : {}),
      ...(deliveryGroup !== "all" ? { delivery_group: deliveryGroup } : {}),
      ...(providerId !== "all" ? { provider_id: providerId } : {}),
    }),
    [activeView, page, pageSize, sort, search, status, bookingState, deliveryGroup, providerId],
  );

  const { data: providers = [] } = useQuery({
    queryKey: ["courier-providers"],
    queryFn: () => getCourierProviders(),
  });

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: ["shipments-console", filters],
    queryFn: () => getShipmentsConsole(filters),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Selection may only ever contain shipments that are still on screen.
  useEffect(() => {
    setSelected((current) => current.filter((id) => rows.some((row) => row.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const selectedRows = rows.filter((row) => selected.includes(row.id));
  const allOnPage = rows.length > 0 && rows.every((row) => selected.includes(row.id));

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
      setSelected([]);
    };
  }

  return (
    <>
      <PageHeader
        title="Shipping desk"
        description={DESCRIPTION}
        actions={
          canManage && selectedRows.length > 0 ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setBulkMode("assign")}>
                Assign courier ({selectedRows.length})
              </Button>
              <Button size="sm" onClick={() => setBulkMode("book")}>
                Book ({selectedRows.length})
              </Button>
            </>
          ) : undefined
        }
      />

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
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Shipment, order, tracking, consignment, recipient or phone"
          className="h-8 w-80 text-[13px]"
          aria-label="Search shipments"
        />
        <Select
          value={status}
          onValueChange={(v) => resetPage(setStatus)(v as ShipmentStatus | "all")}
        >
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SHIPMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SHIPMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={bookingState}
          onValueChange={(v) => resetPage(setBookingState)(v as BookingState | "all")}
        >
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any booking state</SelectItem>
            {(Object.keys(BOOKING_STATE_LABELS) as BookingState[])
              .filter((key) => key !== "none")
              .map((key) => (
                <SelectItem key={key} value={key}>
                  {BOOKING_STATE_LABELS[key]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select
          value={deliveryGroup}
          onValueChange={(v) => resetPage(setDeliveryGroup)(v as DeliveryGroup | "all")}
        >
          <SelectTrigger className="h-8 w-48 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any delivery state</SelectItem>
            {(Object.keys(DELIVERY_GROUP_LABELS) as DeliveryGroup[]).map((key) => (
              <SelectItem key={key} value={key}>
                {DELIVERY_GROUP_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={providerId} onValueChange={resetPage(setProviderId)}>
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All couriers</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => resetPage(setSort)(v as ShipmentSort)}>
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHIPMENT_SORTS.map((key) => (
              <SelectItem key={key} value={key}>
                {SHIPMENT_SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <EmptyState
          icon={AlertTriangle}
          title="Shipments could not be loaded"
          description={(error as Error).message}
        />
      ) : isPending ? (
        <LoadingState rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No shipments match this view"
          description="Adjust the filters, or wait for a packed fulfillment to be handed to a courier."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    checked={allOnPage}
                    aria-label="Select all shipments on this page"
                    onCheckedChange={(checked) =>
                      setSelected(checked === true ? rows.map((row) => row.id) : [])
                    }
                  />
                </th>
                <th className="px-3 py-2 text-left">Shipment</th>
                <th className="px-3 py-2 text-left">Order / customer</th>
                <th className="px-3 py-2 text-left">Destination</th>
                <th className="px-3 py-2 text-left">Courier</th>
                <th className="px-3 py-2 text-left">Booking</th>
                <th className="px-3 py-2 text-right">COD</th>
                <th className="px-3 py-2 text-left">Delivery</th>
                <th className="px-3 py-2 text-left">Flags</th>
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
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40 focus:bg-accent/40 focus:outline-none"
                >
                  <td className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={selected.includes(row.id)}
                      aria-label={`Select ${row.shipment_number}`}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked === true
                            ? [...current, row.id]
                            : current.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to="/orders/shipments/$id"
                      params={{ id: row.id }}
                      className="font-medium text-primary hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.shipment_number}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">
                      {Math.round(row.age_hours)}h old · {row.unit_count} unit(s)
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to="/orders/$id"
                      params={{ id: row.order_id }}
                      className="hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.order_number}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">
                      {row.customer_name} · {row.customer_phone}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block">{row.delivery_area ?? "—"}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {row.delivery_city ?? ""}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block">{row.provider_name ?? "Not assigned"}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {row.tracking_number ?? row.external_consignment_id ?? "No tracking"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      tone={
                        row.booking_state === "failed" || row.booking_state === "recovery_required"
                          ? "danger"
                          : row.booking_state === "booked"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {BOOKING_STATE_LABELS[row.booking_state]}
                    </StatusBadge>
                    {row.booking_attempt_count > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        {row.booking_attempt_count} attempt(s)
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(Number(row.cash_on_delivery_amount))}
                    <div
                      className={`text-[11px] ${row.cod_mismatch ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {row.collected_amount == null
                        ? "Not collected"
                        : `Collected ${formatMoney(Number(row.collected_amount))}`}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={SHIPMENT_STATUS_TONE[row.status]}>
                      {SHIPMENT_STATUS_LABELS[row.status]}
                    </StatusBadge>
                    {row.has_outcome && (
                      <div className="text-[11px] text-muted-foreground">
                        {row.delivered_quantity} delivered
                        {row.refused_quantity > 0 ? ` · ${row.refused_quantity} refused` : ""}
                        {row.lost_quantity > 0 ? ` · ${row.lost_quantity} lost` : ""}
                        {row.damaged_quantity > 0 ? ` · ${row.damaged_quantity} damaged` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">
                    {row.open_exceptions > 0 && (
                      <div className="text-destructive">{row.open_exceptions} exception(s)</div>
                    )}
                    {row.open_returns > 0 && <div>{row.open_returns} return(s)</div>}
                    {row.settlement_status && <div>Settlement: {row.settlement_status}</div>}
                    {row.hold_reason && <div>Hold: {row.hold_reason}</div>}
                    {row.failure_reason && <div>Failed: {row.failure_reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
        <span>
          {total} shipment(s) · page {page} of {pageCount}
          {isFetching ? " · refreshing…" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onValueChange={(v) => resetPage(setPageSize)(Number(v))}
          >
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
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              setSelected([]);
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => {
              setPage((p) => p + 1);
              setSelected([]);
            }}
          >
            Next
          </Button>
        </div>
      </div>

      {quickId && (
        <ShipmentQuickView
          shipmentId={quickId}
          onOpenChange={(open) => !open && setQuickId(null)}
        />
      )}

      {bulkMode && (
        <ShipmentBulkActions
          mode={bulkMode}
          rows={selectedRows}
          onOpenChange={(open) => !open && setBulkMode(null)}
        />
      )}
    </>
  );
}
