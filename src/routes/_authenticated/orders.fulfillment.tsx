import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
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
import { getFulfillmentQueue } from "@/lib/fulfillment";
import { getActiveLocations } from "@/lib/inventory";
import { ORDER_SOURCE_LABELS } from "@/types/orders";
import {
  FULFILLMENT_QUEUE_STATUSES,
  FULFILLMENT_STATUS_LABELS,
  FULFILLMENT_STATUS_TONE,
  RESERVATION_STATUSES,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
  nextFulfillmentAction,
  FULFILLMENT_ACTION_LABELS,
} from "@/types/fulfillment";
import type { FulfillmentStatus, ReservationStatus } from "@/types/fulfillment";

const TITLE = "Warehouse Queue · Commerce Operations";
const DESCRIPTION =
  "Pick, pack and hand over confirmed Bangladesh orders with inventory held at the warehouse.";

export const Route = createFileRoute("/_authenticated/orders/fulfillment")({
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

function Page() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FulfillmentStatus | "all">("all");
  const [reservation, setReservation] = useState<ReservationStatus | "all">("all");
  const [locationId, setLocationId] = useState<string | "all">("all");

  const { data: locations = [] } = useQuery({
    queryKey: ["inventory-locations", "active"],
    queryFn: () => getActiveLocations(),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fulfillment-queue", search, status, reservation, locationId],
    queryFn: () => getFulfillmentQueue({ search, status, reservation, locationId }),
  });

  return (
    <>
      <PageHeader title="Warehouse queue" description={DESCRIPTION} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order number, customer or phone"
          className="h-8 w-64 text-[13px]"
          aria-label="Search warehouse queue"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as FulfillmentStatus | "all")}>
          <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Warehouse status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Open queue</SelectItem>
            {FULFILLMENT_QUEUE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {FULFILLMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={reservation}
          onValueChange={(v) => setReservation(v as ReservationStatus | "all")}
        >
          <SelectTrigger className="h-8 w-40 text-[13px]" aria-label="Stock reservation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any stock state</SelectItem>
            {RESERVATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {RESERVATION_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Warehouse location">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded border border-border">
        {isLoading ? (
          <LoadingState rows={6} label="Loading warehouse queue" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="Nothing in the warehouse queue"
            description="Orders appear here once verification is confirmed and stock is held."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Order</th>
                  <th className="px-3 py-2 text-left font-medium">Customer</th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-left font-medium">Stock</th>
                  <th className="px-3 py-2 text-left font-medium">Warehouse</th>
                  <th className="px-3 py-2 text-left font-medium">Location</th>
                  <th className="px-3 py-2 text-left font-medium">Next step</th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const next = nextFulfillmentAction(r.fulfillment_status, r.reservation_status);
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2">
                        <Link
                          to="/orders/$id"
                          params={{ id: r.id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.order_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {r.customer_name}
                        <div className="text-[11.5px] tabular-nums text-muted-foreground">
                          {r.customer_phone}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.item_count?.[0]?.count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {ORDER_SOURCE_LABELS[r.source]}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={RESERVATION_STATUS_TONE[r.reservation_status]}>
                          {RESERVATION_STATUS_LABELS[r.reservation_status]}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={FULFILLMENT_STATUS_TONE[r.fulfillment_status]}>
                          {FULFILLMENT_STATUS_LABELS[r.fulfillment_status]}
                        </StatusBadge>
                        {r.fulfillment_hold_reason && (
                          <div className="mt-0.5 text-[11.5px] text-destructive">
                            {r.fulfillment_hold_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.location?.name ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {next ? FULFILLMENT_ACTION_LABELS[next] : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
