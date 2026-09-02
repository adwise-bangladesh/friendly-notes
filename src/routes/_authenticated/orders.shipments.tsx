import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
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
import { formatMoney } from "@/lib/currency";
import { getCourierProviders, getShipmentQueue } from "@/lib/shipping";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONE,
} from "@/types/shipping";
import type { ShipmentStatus } from "@/types/shipping";

const TITLE = "Shipping Desk · Commerce Operations";
const DESCRIPTION =
  "Every internal shipment: courier assignment, pickup, transit, delivery outcome and returns.";

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

function Page() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ShipmentStatus | "all" | "active">("active");
  const [providerId, setProviderId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: providers = [] } = useQuery({
    queryKey: ["courier-providers"],
    queryFn: () => getCourierProviders(),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["shipment-queue", search, status, providerId, from, to],
    queryFn: () =>
      getShipmentQueue({
        search,
        status,
        providerId,
        ...(from ? { from: new Date(from).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
      }),
  });

  return (
    <>
      <PageHeader title="Shipping desk" description={DESCRIPTION} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Shipment number, tracking, recipient or phone"
          className="h-8 w-72 text-[13px]"
          aria-label="Search shipments"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="h-8 w-52 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Needs attention</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {SHIPMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SHIPMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger className="h-8 w-48 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All couriers</SelectItem>
            <SelectItem value="unassigned">No courier assigned</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
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
        <LoadingState rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No shipments"
          description="Shipments appear here once a packed fulfillment is handed to a courier."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left">Shipment</th>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Recipient</th>
                <th className="px-3 py-2 text-left">Courier</th>
                <th className="px-3 py-2 text-left">Tracking</th>
                <th className="px-3 py-2 text-right">To collect</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                  <td className="px-3 py-2">
                    <Link
                      to="/orders/shipments/$id"
                      params={{ id: s.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.shipment_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {s.order ? (
                      <Link
                        to="/orders/$id"
                        params={{ id: s.order.id }}
                        className="hover:underline"
                      >
                        {s.order.order_number}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block">{s.recipient_name}</span>
                    <span className="text-[11px] text-muted-foreground">{s.recipient_phone}</span>
                  </td>
                  <td className="px-3 py-2">{s.provider?.name ?? "—"}</td>
                  <td className="px-3 py-2">{s.tracking_number ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {formatMoney(Number(s.cash_on_delivery_amount))}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={SHIPMENT_STATUS_TONE[s.status]}>
                      {SHIPMENT_STATUS_LABELS[s.status]}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
