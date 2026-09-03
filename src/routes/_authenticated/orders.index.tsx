import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Plus, ShoppingCart } from "lucide-react";
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
import type { StatusTone } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { OrderQuickView } from "@/components/orders/OrderQuickView";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import { invalidateOrderSurfaces } from "@/lib/order-cache";
import {
  ORDER_SORTS,
  ORDER_SORT_LABELS,
  bulkClaimVerification,
  getOrdersConsole,
} from "@/lib/orders-console";
import type { OrderSort, OrdersConsoleFilters } from "@/lib/orders-console";
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
} from "@/types/orders";
import {
  FULFILLMENT_STATUSES,
  FULFILLMENT_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
  ORDER_SOURCES,
  ORDER_SOURCE_LABELS,
} from "@/types/orders";
import type {
  DeliveryStatus,
  ReservationStatus,
  FulfillmentStatus,
  OrderSource,
  OrderStatus,
  PaymentStatus,
} from "@/types/orders";
import {
  RISK_LEVELS,
  RISK_LEVEL_TONE,
  VERIFICATION_PRIORITIES,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_TONE,
} from "@/types/verification";
import type { RiskLevel, VerificationPriority, VerificationStatus } from "@/types/verification";

const TITLE = "Orders console · Commerce Operations";
const DESCRIPTION =
  "Process COD orders at speed: verify, assign, ship and collect from one dense console.";

export const Route = createFileRoute("/_authenticated/orders/")({
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

const ORDER_TONE: Record<OrderStatus, StatusTone> = {
  draft: "neutral",
  created: "info",
  cancelled: "danger",
};

const PAYMENT_TONE: Record<PaymentStatus, StatusTone> = {
  unpaid: "warning",
  partial: "warning",
  paid: "success",
  refunded: "neutral",
};

const PAGE_SIZES = [25, 50, 100];

interface SavedView {
  name: string;
  filters: OrdersConsoleFilters;
}

const BUILT_IN_VIEWS: SavedView[] = [
  { name: "Needs attention", filters: { attention: true, sort: "priority" } },
  { name: "Awaiting verification", filters: { verification_status: "pending", sort: "priority" } },
  { name: "Assigned to me", filters: { assigned_to: "me" } },
  { name: "Unassigned", filters: { assigned_to: "unassigned", verification_status: "pending" } },
  { name: "COD due", filters: { payment_status: "unpaid", delivery_status: "delivered" } },
  { name: "Ready for warehouse", filters: { ready_for_warehouse: true, sort: "oldest" } },
  { name: "Shipping attention", filters: { shipping_attention: true } },
  { name: "High risk", filters: { risk_level: "high", sort: "priority" } },
  { name: "Open returns", filters: { has_open_return: true } },
  { name: "Open exceptions", filters: { has_exception: true } },
];

const VIEWS_KEY = "orders-console-views";

function Page() {
  const { canManage } = useCommercePermissions();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<OrdersConsoleFilters>({
    page: 1,
    page_size: 50,
    sort: "newest",
  });
  const [searchInput, setSearchInput] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEWS_KEY);
      if (raw) setSavedViews(JSON.parse(raw) as SavedView[]);
    } catch {
      /* ignore unreadable saved views */
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(
      () => setFilters((f) => ({ ...f, search: searchInput.trim(), page: 1 })),
      300,
    );
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const [showAdvanced, setShowAdvanced] = useState(false);

  // Selection is only ever valid for the exact result set it was made against.
  const contextKey = JSON.stringify(filters);
  useEffect(() => {
    setSelected([]);
  }, [contextKey]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["orders-console", filters],
    queryFn: () => getOrdersConsole(filters),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = filters.page_size ?? 50;
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const pageIds = rows.map((r) => r.id);
  const allSelected = rows.length > 0 && pageIds.every((id) => selected.includes(id));

  const claimSelected = useMutation({
    mutationFn: () => bulkClaimVerification(selected),
    onSuccess: (res) => {
      if (res.failed === 0) toast.success(`Claimed ${res.succeeded} order(s)`);
      else {
        const first = res.results.find((r) => !r.ok);
        toast.warning(
          `Claimed ${res.succeeded}, skipped ${res.failed}. ${
            first ? `${first.order_number ?? "One order"}: ${first.error}` : ""
          }`,
        );
      }
      // Keep only the orders that could not be claimed, so the operator can act on them.
      setSelected(res.results.filter((r) => !r.ok).map((r) => r.order_id));
      invalidateOrderSurfaces(queryClient);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setFilter = <K extends keyof OrdersConsoleFilters>(
    key: K,
    value: OrdersConsoleFilters[K],
  ) => setFilters((f) => ({ ...f, [key]: value, page: 1 }));

  const applyView = (view: SavedView) => {
    setSearchInput("");
    setFilters({ page: 1, page_size: pageSize, sort: "newest", ...view.filters });
  };

  const saveCurrentView = () => {
    const name = window.prompt("Name this view");
    if (!name) return;
    const next = [...savedViews.filter((v) => v.name !== name), { name, filters }];
    setSavedViews(next);
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
  };

  const activeCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([k, v]) =>
          !["page", "page_size", "sort"].includes(k) && v !== undefined && v !== "" && v !== false,
      ).length,
    [filters],
  );

  return (
    <>
      <PageHeader
        title="Orders"
        description={DESCRIPTION}
        actions={
          canManage ? (
            <Button asChild size="sm" className="h-8">
              <Link to="/orders/new">
                <Plus className="mr-1 h-3.5 w-3.5" /> New order
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {[...BUILT_IN_VIEWS, ...savedViews].map((v) => (
          <Button
            key={v.name}
            size="sm"
            variant="outline"
            className="h-7 text-[12px]"
            onClick={() => applyView(v)}
          >
            {v.name}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[12px]"
          onClick={() => {
            setSearchInput("");
            setFilters({ page: 1, page_size: pageSize, sort: "newest" });
          }}
        >
          Reset{activeCount ? ` (${activeCount})` : ""}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={saveCurrentView}>
          Save view
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Order, customer, phone or address"
          className="h-8 w-60 text-[13px]"
          aria-label="Search orders"
        />
        <Input
          value={filters.product_search ?? ""}
          onChange={(e) => setFilter("product_search", e.target.value || undefined)}
          placeholder="Product / SKU"
          className="h-8 w-40 text-[13px]"
          aria-label="Product search"
        />
        <Input
          value={filters.district ?? ""}
          onChange={(e) => setFilter("district", e.target.value || undefined)}
          placeholder="District"
          className="h-8 w-32 text-[13px]"
          aria-label="District"
        />
        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) => setFilter("status", v === "all" ? undefined : (v as OrderStatus))}
        >
          <SelectTrigger className="h-8 w-36 text-[13px]" aria-label="Order status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.verification_status ?? "all"}
          onValueChange={(v) =>
            setFilter("verification_status", v === "all" ? undefined : (v as VerificationStatus))
          }
        >
          <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Verification status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verification</SelectItem>
            {VERIFICATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {VERIFICATION_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.delivery_status ?? "all"}
          onValueChange={(v) =>
            setFilter("delivery_status", v === "all" ? undefined : (v as DeliveryStatus))
          }
        >
          <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Delivery status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All delivery states</SelectItem>
            {DELIVERY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {DELIVERY_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.payment_status ?? "all"}
          onValueChange={(v) =>
            setFilter("payment_status", v === "all" ? undefined : (v as PaymentStatus))
          }
        >
          <SelectTrigger className="h-8 w-36 text-[13px]" aria-label="Payment status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.sort ?? "newest"}
          onValueChange={(v) => setFilter("sort", v as OrderSort)}
        >
          <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Sort orders">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORDER_SORTS.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_SORT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={filters.from?.slice(0, 10) ?? ""}
          onChange={(e) =>
            setFilter(
              "from",
              e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : undefined,
            )
          }
          className="h-8 w-36 text-[13px]"
          aria-label="From date"
        />
        <Input
          type="date"
          value={filters.to?.slice(0, 10) ?? ""}
          onChange={(e) =>
            setFilter(
              "to",
              e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : undefined,
            )
          }
          className="h-8 w-36 text-[13px]"
          aria-label="To date"
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-[12px]"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Fewer filters" : "More filters"}
        </Button>
      </div>

      {showAdvanced ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select
            value={filters.risk_level ?? "all"}
            onValueChange={(v) =>
              setFilter("risk_level", v === "all" ? undefined : (v as RiskLevel))
            }
          >
            <SelectTrigger className="h-8 w-36 text-[13px]" aria-label="Risk level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              {RISK_LEVELS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s} risk
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.verification_priority ?? "all"}
            onValueChange={(v) =>
              setFilter(
                "verification_priority",
                v === "all" ? undefined : (v as VerificationPriority),
              )
            }
          >
            <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Verification priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {VERIFICATION_PRIORITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s} priority
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.fulfillment_status ?? "all"}
            onValueChange={(v) =>
              setFilter("fulfillment_status", v === "all" ? undefined : (v as FulfillmentStatus))
            }
          >
            <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Fulfillment status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All fulfillment states</SelectItem>
              {FULFILLMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {FULFILLMENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.source ?? "all"}
            onValueChange={(v) => setFilter("source", v === "all" ? undefined : (v as OrderSource))}
          >
            <SelectTrigger className="h-8 w-36 text-[13px]" aria-label="Order source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {ORDER_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ORDER_SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={filters.area ?? ""}
            onChange={(e) => setFilter("area", e.target.value || undefined)}
            placeholder="Area / thana"
            className="h-8 w-36 text-[13px]"
            aria-label="Area"
          />
        </div>
      ) : null}


      {canManage && selected.length > 0 ? (
        <div className="mb-2 flex items-center gap-2 rounded border border-border bg-muted/40 px-3 py-1.5 text-[13px]">
          <span>{selected.length} selected</span>
          <Button
            size="sm"
            className="h-7"
            disabled={claimSelected.isPending}
            onClick={() => claimSelected.mutate()}
          >
            Claim verification
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="rounded border border-border">
        {isLoading ? (
          <LoadingState rows={8} label="Loading orders" />
        ) : isError ? (
          <div className="space-y-3 p-6 text-[13px]">
            <p className="text-destructive">{(error as Error).message}</p>
            <Button size="sm" variant="outline" className="h-8" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No matching orders"
            description="Adjust the filters or create a new order."
            action={
              canManage ? (
                <Button asChild size="sm" className="h-8">
                  <Link to="/orders/new">New order</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2">
                    <Checkbox
                      checked={allSelected}
                      aria-label="Select page"
                      onCheckedChange={(c) =>
                        setSelected((s) =>
                          c === true
                            ? [...new Set([...s, ...pageIds])]
                            : s.filter((id) => !pageIds.includes(id)),
                        )
                      }
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Order</th>
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-left font-medium">Area</th>
                  <th className="px-3 py-2 text-left font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">COD due</th>
                  <th className="px-3 py-2 text-left font-medium">Payment</th>
                  <th className="px-3 py-2 text-left font-medium">Verification</th>
                  <th className="px-3 py-2 text-left font-medium">Warehouse</th>
                  <th className="px-3 py-2 text-left font-medium">Delivery</th>
                  <th className="px-3 py-2 text-left font-medium">Courier</th>
                  <th className="px-3 py-2 text-left font-medium">Owner</th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody className={isFetching ? "opacity-60 transition-opacity" : undefined}>
                {rows.map((o) => (
                  <tr
                    key={o.id}
                    tabIndex={0}
                    onClick={() => setQuickViewId(o.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setQuickViewId(o.id);
                      }
                    }}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40 focus:bg-muted/60 focus:outline-none"
                  >
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.includes(o.id)}
                        aria-label={`Select ${o.order_number}`}
                        onCheckedChange={(c) =>
                          setSelected((s) =>
                            c === true ? [...s, o.id] : s.filter((x) => x !== o.id),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{o.order_number}</span>
                        {o.open_exceptions > 0 || o.fulfillment_hold_reason ? (
                          <AlertTriangle
                            className="h-3.5 w-3.5 text-destructive"
                            aria-label="Needs attention"
                          />
                        ) : null}
                      </div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {o.store_name ?? ORDER_SOURCE_LABELS[o.source]}
                      </div>
                      <div className="flex gap-1 pt-0.5">
                        <StatusBadge tone={ORDER_TONE[o.status]}>
                          {ORDER_STATUS_LABELS[o.status]}
                        </StatusBadge>
                        {o.risk_level !== "none" ? (
                          <span title={o.risk_reason ?? `${o.risk_level} risk`}>
                            <StatusBadge tone={RISK_LEVEL_TONE[o.risk_level]}>
                              {o.risk_level}
                            </StatusBadge>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{o.customer_name}</div>
                      <div className="tabular-nums text-muted-foreground">{o.customer_phone}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {[o.area, o.district].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {o.first_item ?? "—"}
                      {o.item_lines > 1 ? ` +${o.item_lines - 1}` : ""}
                      <span className="tabular-nums"> ({o.unit_count})</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(o.grand_total))}
                      {Number(o.paid_amount) > 0 ? (
                        <div className="text-[11.5px] text-muted-foreground">
                          {formatMoney(Number(o.paid_amount))} collected
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(Number(o.due_amount))}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={PAYMENT_TONE[o.payment_status]}>
                        {PAYMENT_STATUS_LABELS[o.payment_status]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={VERIFICATION_STATUS_TONE[o.verification_status]}>
                        {VERIFICATION_STATUS_LABELS[o.verification_status]}
                      </StatusBadge>
                      {o.verification_attempt_count > 0 ? (
                        <span className="pl-1 text-[11.5px] text-muted-foreground">
                          {o.verification_attempt_count} try
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <div>{RESERVATION_STATUS_LABELS[o.reservation_status as ReservationStatus] ?? o.reservation_status}</div>
                      <div className="text-[11.5px]">
                        {o.ready_for_warehouse
                          ? "Ready for warehouse"
                          : FULFILLMENT_STATUS_LABELS[o.fulfillment_status]}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={DELIVERY_STATUS_TONE[o.delivery_status]}>
                        {DELIVERY_STATUS_LABELS[o.delivery_status]}
                      </StatusBadge>
                      {o.shipment_status ? (
                        <div className="text-[11.5px] text-muted-foreground">
                          {o.shipment_status.replace(/_/g, " ")}
                        </div>
                      ) : null}
                      {o.open_returns > 0 ? (
                        <div className="text-[11.5px] text-destructive">
                          {o.open_returns} open return{o.open_returns > 1 ? "s" : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {o.courier_name ?? "—"}
                      {o.tracking_number ? (
                        <div className="text-[11.5px]">{o.tracking_number}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {o.assigned_is_mine ? "You" : (o.assigned_name ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <div>{new Date(o.created_at).toLocaleDateString()}</div>
                      <div className="text-[11.5px]">
                        {new Date(o.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="text-muted-foreground">
          {total} order{total === 1 ? "" : "s"} · page {page} of {pageCount}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onValueChange={(v) => setFilters((f) => ({ ...f, page_size: Number(v), page: 1 }))}
          >
            <SelectTrigger className="h-8 w-24 text-[13px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={page >= pageCount}
            onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}
          >
            Next
          </Button>
        </div>
      </div>

      <OrderQuickView
        orderId={quickViewId}
        onOpenChange={(open) => {
          if (!open) setQuickViewId(null);
        }}
      />
    </>
  );
}
