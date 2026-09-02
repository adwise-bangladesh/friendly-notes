import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { ExceptionActionDialog } from "@/components/orders/ExceptionActionDialog";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import { getExceptionQueue } from "@/lib/returns";
import {
  EXCEPTION_STATUSES,
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_STATUS_TONE,
  EXCEPTION_TYPES,
  EXCEPTION_TYPE_LABELS,
  exceptionActions,
} from "@/types/returns";
import type {
  ExceptionAction,
  ExceptionQueueRow,
  ShipmentExceptionStatus,
  ShipmentExceptionType,
} from "@/types/returns";

const TITLE = "Delivery Exceptions · Commerce Operations";
const DESCRIPTION =
  "Failed deliveries, holds and pickup problems that need an operator decision.";

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

function Page() {
  const { canManage } = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ShipmentExceptionStatus | "all" | "open">("open");
  const [type, setType] = useState<ShipmentExceptionType | "all">("all");
  const [pending, setPending] = useState<{
    row: ExceptionQueueRow;
    action: ExceptionAction;
    label: string;
    needsNote: boolean;
  } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["exception-queue", search, status, type],
    queryFn: () => getExceptionQueue({ search, status, type }),
  });

  return (
    <>
      <PageHeader
        title="Delivery Exceptions"
        description="Every incident a courier reported or an operator raised, until somebody closes it with a reason."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          className="h-9 w-64"
          placeholder="Order, customer, phone or shipment"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <SelectTrigger className="h-9 w-44">
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
        <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
          <SelectTrigger className="h-9 w-52">
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
      </div>

      {isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No delivery exceptions"
          description="Courier problems appear here automatically as soon as they are reported."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Incident</th>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Shipment</th>
                <th className="px-3 py-2 font-medium">Reported</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const actions = canManage ? exceptionActions(row.status) : [];
                return (
                  <tr key={row.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {EXCEPTION_TYPE_LABELS[row.exception_type]}
                      </div>
                      <div className="text-[12px] text-muted-foreground">
                        {row.courier_reason ?? row.reason ?? "No reason reported"}
                      </div>
                      {row.collected_amount != null && (
                        <div className="text-[12px] text-muted-foreground">
                          Collected {formatMoney(row.collected_amount)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to="/orders/$id"
                        params={{ id: row.order_id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.order?.order_number ?? "Order"}
                      </Link>
                      <div className="text-[12px] text-muted-foreground">
                        {row.order?.customer_name} · {row.order?.customer_phone}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.shipment?.shipment_number ?? "—"}</div>
                      <div className="text-[12px] text-muted-foreground">
                        {row.shipment?.tracking_number ?? "No tracking"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {new Date(row.occurred_at).toLocaleString()}
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
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {actions.map((item) => (
                          <Button
                            key={item.action}
                            size="sm"
                            variant={item.action === "resolve" ? "default" : "outline"}
                            onClick={() =>
                              setPending({
                                row,
                                action: item.action,
                                label: item.label,
                                needsNote: item.needsNote,
                              })
                            }
                          >
                            {item.label}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pending && (
        <ExceptionActionDialog
          exception={pending.row}
          action={pending.action}
          label={pending.label}
          needsNote={pending.needsNote}
          onOpenChange={(open) => !open && setPending(null)}
        />
      )}
    </>
  );
}
