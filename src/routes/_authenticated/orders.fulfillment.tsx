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
import { getFulfillmentRecordQueue } from "@/lib/fulfillment-records";
import { getActiveLocations } from "@/lib/inventory";
import {
  FULFILLMENT_RECORD_STATUSES,
  FULFILLMENT_RECORD_STATUS_LABELS,
  FULFILLMENT_RECORD_STATUS_TONE,
} from "@/types/fulfillment-records";
import type { FulfillmentRecordStatus } from "@/types/fulfillment-records";

const TITLE = "Warehouse Queue · Commerce Operations";
const DESCRIPTION =
  "Every warehouse fulfillment in progress: picking, quality control, packing and handover readiness.";

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
  const [status, setStatus] = useState<FulfillmentRecordStatus | "all" | "active">("active");
  const [locationId, setLocationId] = useState<string | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: locations = [] } = useQuery({
    queryKey: ["inventory-locations", "active"],
    queryFn: () => getActiveLocations(),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fulfillment-record-queue", search, status, locationId, from, to],
    queryFn: () =>
      getFulfillmentRecordQueue({
        search,
        status,
        locationId,
        ...(from ? { from: new Date(from).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
      }),
  });

  return (
    <>
      <PageHeader title="Warehouse queue" description={DESCRIPTION} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order number, customer, phone or fulfillment number"
          className="h-8 w-72 text-[13px]"
          aria-label="Search the warehouse queue"
        />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as FulfillmentRecordStatus | "all" | "active")}
        >
          <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Fulfillment status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active work</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {FULFILLMENT_RECORD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {FULFILLMENT_RECORD_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="h-8 w-44 text-[13px]" aria-label="Warehouse">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All warehouses</SelectItem>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 w-36 text-[13px]"
          aria-label="Created from"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 w-36 text-[13px]"
          aria-label="Created to"
        />
      </div>

      {isLoading ? (
        <LoadingState rows={8} label="Loading warehouse queue" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Nothing in the warehouse queue"
          description="Fulfillments appear here once they are created from a confirmed order."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Fulfillment</th>
                <th className="px-2 py-1.5 font-medium">Order</th>
                <th className="px-2 py-1.5 font-medium">Customer</th>
                <th className="px-2 py-1.5 font-medium">Warehouse</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 text-right font-medium">Items</th>
                <th className="px-2 py-1.5 font-medium">Progress</th>
                <th className="px-2 py-1.5 font-medium">Created</th>
                <th className="px-2 py-1.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const planned = row.items.reduce((sum, i) => sum + i.quantity, 0);
                const picked = row.items.reduce((sum, i) => sum + i.picked_quantity, 0);
                return (
                  <tr key={row.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-2 py-1.5">
                      <Link
                        to="/orders/fulfillments/$id"
                        params={{ id: row.id }}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        #{row.fulfillment_number}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">
                      {row.order && (
                        <Link
                          to="/orders/$id"
                          params={{ id: row.order.id }}
                          className="underline-offset-2 hover:underline"
                        >
                          {row.order.order_number}
                        </Link>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.order?.customer_name}
                      <span className="block text-[11.5px] text-muted-foreground">
                        {row.order?.customer_phone}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{row.location?.name ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <StatusBadge tone={FULFILLMENT_RECORD_STATUS_TONE[row.status]}>
                        {FULFILLMENT_RECORD_STATUS_LABELS[row.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.items.length}</td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {picked} / {planned} units picked
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {new Date(row.updated_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
