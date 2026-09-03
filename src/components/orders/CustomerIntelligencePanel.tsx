import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { FormSection } from "@/components/commerce/FormSection";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import { getOrderCustomerIntelligence } from "@/lib/orders";
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_TONE, ORDER_STATUS_LABELS } from "@/types/orders";

/**
 * Operational history of the person behind this order, so the verification and
 * shipping desks can judge COD risk without leaving the order.
 */
export function CustomerIntelligencePanel({ orderId }: { orderId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["order-customer-intelligence", orderId],
    queryFn: () => getOrderCustomerIntelligence(orderId),
  });

  const metrics = data?.metrics ?? null;

  return (
    <FormSection
      title="Customer history"
      description="Past behaviour of this phone number — previous orders, delivery success and any manual flag."
    >
      {isPending ? (
        <p className="text-[12.5px] text-muted-foreground">Loading customer history…</p>
      ) : isError ? (
        <p className="text-[12.5px] text-muted-foreground">Customer history is not available.</p>
      ) : !data?.linked ? (
        <p className="text-[12.5px] text-muted-foreground">
          This order is not linked to a saved customer record yet.
        </p>
      ) : (
        <div className="space-y-3">
          {data.flags.length > 0 && (
            <div className="space-y-1 rounded border border-destructive/40 bg-destructive/5 p-2">
              {data.flags.map((flag, i) => (
                <p
                  key={`${flag.flag}-${i}`}
                  className="flex items-start gap-1.5 text-[12.5px] text-foreground"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span>
                    <span className="font-medium">{flag.flag.replace(/_/g, " ")}</span>
                    {flag.reason ? ` — ${flag.reason}` : ""}
                  </span>
                </p>
              ))}
            </div>
          )}

          {metrics && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Orders" value={String(metrics["total_orders"] ?? 0)} />
              <Metric label="Delivered" value={String(metrics["delivered_orders"] ?? 0)} />
              <Metric label="Returned" value={String(metrics["returned_orders"] ?? 0)} />
              <Metric label="Cancelled" value={String(metrics["cancelled_orders"] ?? 0)} />
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recent orders
            </p>
            {data.recent_orders.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">This is their first order.</p>
            ) : (
              data.recent_orders.map((o) => (
                <Link
                  key={o.id}
                  to="/orders/$id"
                  params={{ id: o.id }}
                  className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1.5 text-[12.5px] hover:bg-muted/50"
                >
                  <span className="font-medium">#{o.order_number}</span>
                  <StatusBadge tone={DELIVERY_STATUS_TONE[o.delivery_status]}>
                    {DELIVERY_STATUS_LABELS[o.delivery_status]}
                  </StatusBadge>
                  <span className="text-muted-foreground">{ORDER_STATUS_LABELS[o.status]}</span>
                  <span className="ml-auto tabular-nums">{formatMoney(Number(o.grand_total))}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </FormSection>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[13px] font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}
