import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormSection } from "@/components/commerce/FormSection";
import { ShipmentCreateDialog } from "./ShipmentCreateDialog";
import { formatMoney } from "@/lib/currency";
import { getOrderShipments } from "@/lib/shipping";
import { getOrderFulfillments } from "@/lib/fulfillment-records";
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONE } from "@/types/shipping";
import type { OrderWithDetails } from "@/types/orders";

/**
 * Shipping overview for one order: every internal shipment plus the ability to
 * hand a packed fulfillment to a courier. Eligibility (a fulfillment that has
 * reached ready for handover) is re-checked inside `create_shipment`.
 */
export function OrderShipmentsPanel({
  order,
  canManage,
}: {
  order: OrderWithDetails;
  canManage: boolean;
}) {
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const { data: shipments = [], isPending: shipmentsPending } = useQuery({
    queryKey: ["order-shipments", order.id],
    queryFn: () => getOrderShipments(order.id),
  });

  const { data: fulfillments = [] } = useQuery({
    queryKey: ["order-fulfillments", order.id],
    queryFn: () => getOrderFulfillments(order.id),
  });

  const eligible = fulfillments.filter((f) => f.status === "ready_for_handover");
  const due = Number(order.due_amount ?? 0);
  const suggestedCod = order.payment_method === "cod" ? Math.max(0, due) : 0;

  return (
    <FormSection
      title="Shipping"
      description="Internal shipment records. Courier assignment is recorded manually; no courier system is contacted."
    >
      {shipmentsPending ? (
        <p className="text-[12.5px] text-muted-foreground">Loading shipments…</p>
      ) : shipments.length === 0 ? (
        <EmptyState
          title="No shipments yet"
          description="A shipment can be created once a fulfillment is ready for handover."
          compact
        />
      ) : (
        <div className="space-y-2">
          {shipments.map((s) => (
            <Link
              key={s.id}
              to="/orders/shipments/$id"
              params={{ id: s.id }}
              className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2 hover:bg-accent/50"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{s.shipment_number}</p>
                <p className="text-[11px] text-muted-foreground">
                  {s.provider?.name ?? "No courier assigned"}
                  {s.tracking_number ? ` · ${s.tracking_number}` : ""} ·{" "}
                  {formatMoney(Number(s.cash_on_delivery_amount))} to collect
                </p>
              </div>
              <StatusBadge tone={SHIPMENT_STATUS_TONE[s.status]}>
                {SHIPMENT_STATUS_LABELS[s.status]}
              </StatusBadge>
            </Link>
          ))}
        </div>
      )}

      {canManage && eligible.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {eligible.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3">
              <p className="text-[12px] text-muted-foreground">
                Fulfillment #{f.fulfillment_number} is ready for handover.
              </p>
              <Button size="sm" variant="outline" onClick={() => setCreatingFor(f.id)}>
                <Truck className="mr-1 h-3.5 w-3.5" />
                Create shipment
              </Button>
            </div>
          ))}
        </div>
      )}

      {creatingFor && (
        <ShipmentCreateDialog
          fulfillmentId={creatingFor}
          orderId={order.id}
          suggestedCod={suggestedCod}
          open={!!creatingFor}
          onOpenChange={(open) => !open && setCreatingFor(null)}
        />
      )}
    </FormSection>
  );
}
