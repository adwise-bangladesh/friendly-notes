import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
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
import { getReturnQueue } from "@/lib/returns";
import {
  RETURN_STATUSES,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONE,
  RETURN_TYPES,
  RETURN_TYPE_LABELS,
} from "@/types/returns";
import type { OrderReturnStatus, OrderReturnType } from "@/types/returns";

const TITLE = "Returns · Commerce Operations";
const DESCRIPTION =
  "Returned parcels from pickup to inspection, with what physically came back.";

export const Route = createFileRoute("/_authenticated/returns")({
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
  const [status, setStatus] = useState<OrderReturnStatus | "all" | "open">("open");
  const [type, setType] = useState<OrderReturnType | "all">("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["return-queue", search, status, type],
    queryFn: () => getReturnQueue({ search, status, type }),
  });

  return (
    <>
      <PageHeader
        title="Returns"
        description="Every return the business is tracking. Quantities are what was counted on arrival, never what was expected."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="h-9 w-64"
          placeholder="Return, order, customer or tracking"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">In progress</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {RETURN_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {RETURN_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All return types</SelectItem>
            {RETURN_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {RETURN_TYPE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title="No returns"
          description="Courier-reported returns land here automatically; you can also open one from an order."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Return</th>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Shipment</th>
                <th className="px-3 py-2 font-medium">Lines</th>
                <th className="px-3 py-2 font-medium">Opened</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      to="/returns/$id"
                      params={{ id: row.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      {row.return_number}
                    </Link>
                    <div className="text-[12px] text-muted-foreground">
                      {RETURN_TYPE_LABELS[row.return_type]}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to="/orders/$id"
                      params={{ id: row.order_id }}
                      className="text-primary hover:underline"
                    >
                      {row.order?.order_number ?? "Order"}
                    </Link>
                    <div className="text-[12px] text-muted-foreground">
                      {row.order?.customer_name}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{row.shipment?.shipment_number ?? "—"}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {row.tracking_reference ?? "No return tracking"}
                    </div>
                  </td>
                  <td className="px-3 py-2">{row.item_count}</td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {new Date(row.requested_at).toLocaleString()}
                    <div>{row.source === "courier" ? "From courier" : "Manual"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={RETURN_STATUS_TONE[row.status]}>
                      {RETURN_STATUS_LABELS[row.status]}
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
