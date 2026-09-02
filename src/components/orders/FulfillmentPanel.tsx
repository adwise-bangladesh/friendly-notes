import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, PackageCheck, PauseCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FormSection } from "@/components/commerce/FormSection";
import { MediaImage } from "@/components/commerce/MediaImage";
import {
  getOrderReservations,
  getPickList,
  releaseOrderReservations,
  reserveOrderInventory,
  setFulfillmentState,
} from "@/lib/fulfillment";
import type { FulfillmentStateAction } from "@/lib/fulfillment";
import {
  FULFILLMENT_ACTION_LABELS,
  FULFILLMENT_STATUS_LABELS,
  FULFILLMENT_STATUS_MEANINGS,
  FULFILLMENT_STATUS_TONE,
  RESERVATION_RECORD_STATUS_LABELS,
  RESERVATION_RECORD_STATUS_TONE,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_MEANINGS,
  RESERVATION_STATUS_TONE,
  availableFulfillmentActions,
} from "@/types/fulfillment";
import type { FulfillmentAction } from "@/types/fulfillment";
import type { OrderWithDetails } from "@/types/orders";

/**
 * Warehouse operations for one order.
 *
 * Nothing here writes stock directly: every button calls a database function
 * that validates the transition, and stock only leaves on hand once, when the
 * order is marked packed.
 */
export function FulfillmentPanel({
  order,
  canManage,
}: {
  order: OrderWithDetails;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [holdReason, setHoldReason] = useState("");
  const [showHold, setShowHold] = useState(false);

  const fulfillment = order.fulfillment_status;
  const reservation = order.reservation_status;

  const { data: pickList = [] } = useQuery({
    queryKey: ["pick-list", order.id],
    queryFn: () => getPickList(order.id),
  });
  const { data: reservations = [] } = useQuery({
    queryKey: ["order-reservations", order.id],
    queryFn: () => getOrderReservations(order.id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
    void queryClient.invalidateQueries({ queryKey: ["order-reservations", order.id] });
    void queryClient.invalidateQueries({ queryKey: ["pick-list", order.id] });
    void queryClient.invalidateQueries({ queryKey: ["fulfillment-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  const fail = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "The warehouse action was rejected");

  const reserveMutation = useMutation({
    mutationFn: () => reserveOrderInventory(order.id),
    onSuccess: () => {
      refresh();
      toast.success("Reservation attempted — see the order state below");
    },
    onError: fail,
  });

  const stateMutation = useMutation({
    mutationFn: (args: { action: FulfillmentStateAction; reason?: string }) =>
      setFulfillmentState({ orderId: order.id, action: args.action, reason: args.reason ?? null }),
    onSuccess: () => {
      refresh();
      setShowHold(false);
      setHoldReason("");
      toast.success("Warehouse state updated");
    },
    onError: fail,
  });

  const releaseMutation = useMutation({
    mutationFn: (reason: string) => releaseOrderReservations(order.id, reason),
    onSuccess: () => {
      refresh();
      toast.success("Held stock returned to available");
    },
    onError: fail,
  });

  const actions = availableFulfillmentActions({
    orderStatus: order.status,
    verificationStatus: order.verification_status,
    fulfillment,
    reservation,
  });
  const busy = reserveMutation.isPending || stateMutation.isPending || releaseMutation.isPending;

  const run = (action: FulfillmentAction) => {
    if (action === "reserve" || action === "retry_reservation") {
      reserveMutation.mutate();
      return;
    }
    if (action === "hold") {
      setShowHold(true);
      return;
    }
    stateMutation.mutate({ action: action as FulfillmentStateAction });
  };

  const activeReservations = reservations.filter((r) => r.status === "active");

  return (
    <FormSection
      title="Warehouse"
      description="Inventory is held when verification is confirmed and deducted only when the order is packed."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={FULFILLMENT_STATUS_TONE[fulfillment]}>
          Warehouse · {FULFILLMENT_STATUS_LABELS[fulfillment]}
        </StatusBadge>
        <StatusBadge tone={RESERVATION_STATUS_TONE[reservation]}>
          Stock · {RESERVATION_STATUS_LABELS[reservation]}
        </StatusBadge>
        {order.reserved_at && (
          <span className="text-[11.5px] text-muted-foreground">
            Reserved {new Date(order.reserved_at).toLocaleString()}
          </span>
        )}
        {order.packed_at && (
          <span className="text-[11.5px] text-muted-foreground">
            Packed {new Date(order.packed_at).toLocaleString()}
          </span>
        )}
      </div>

      <p className="mb-1 text-[12px] text-muted-foreground">
        {FULFILLMENT_STATUS_MEANINGS[fulfillment]}
      </p>
      <p className="mb-3 text-[12px] text-muted-foreground">
        {RESERVATION_STATUS_MEANINGS[reservation]}
      </p>

      {order.fulfillment_hold_reason && (
        <div className="mb-3 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12.5px] text-destructive">
          <PauseCircle className="mr-1 inline h-3.5 w-3.5" />
          {order.fulfillment_hold_reason}
        </div>
      )}

      {order.verification_status !== "confirmed" && order.status !== "cancelled" && (
        <p className="mb-3 rounded border border-border bg-muted/40 p-2 text-[12.5px] text-muted-foreground">
          Warehouse work starts after the customer confirms this order on a verification call.
        </p>
      )}

      {canManage && actions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === "hold" ? "outline" : "default"}
              className="h-8"
              disabled={busy}
              onClick={() => run(a)}
            >
              {a === "mark_packed" && <PackageCheck className="mr-1 h-3.5 w-3.5" />}
              {FULFILLMENT_ACTION_LABELS[a]}
            </Button>
          ))}
          {activeReservations.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              disabled={busy}
              onClick={() => releaseMutation.mutate("Released manually from the order page")}
            >
              Release held stock
            </Button>
          )}
        </div>
      )}

      {showHold && (
        <div className="mb-3 flex items-center gap-2">
          <Input
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            placeholder="Why is this order on hold?"
            className="h-8 text-[13px]"
            aria-label="Hold reason"
          />
          <Button
            size="sm"
            className="h-8"
            disabled={!holdReason.trim() || busy}
            onClick={() => stateMutation.mutate({ action: "hold", reason: holdReason.trim() })}
          >
            Hold
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setShowHold(false)}>
            Cancel
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-[13px]">
          <thead className="border-b border-border bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Pick list</th>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-left font-medium">Location</th>
              <th className="px-3 py-2 text-right font-medium">Required</th>
              <th className="px-3 py-2 text-right font-medium">Held</th>
            </tr>
          </thead>
          <tbody>
            {pickList.map((l) => (
              <tr key={l.orderItemId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <MediaImage path={l.imageUrl} alt={l.productName} className="h-8 w-8 rounded" />
                    <div>
                      <p className="font-medium text-foreground">{l.productName}</p>
                      {l.variantName && (
                        <p className="text-[11.5px] text-muted-foreground">{l.variantName}</p>
                      )}
                      {!l.stockTracked && (
                        <p className="text-[11.5px] text-muted-foreground">
                          Not stock tracked — nothing to pick.
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{l.sku ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{l.locationName ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.requiredQuantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.reservedQuantity}</td>
              </tr>
            ))}
            {pickList.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-[13px] text-muted-foreground">
                  No items to pick.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reservations.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 flex items-center gap-1 text-[12px] font-medium text-foreground">
            <Boxes className="h-3.5 w-3.5" /> Reservation history
          </p>
          <ul className="space-y-1">
            {reservations.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded border border-border px-2 py-1 text-[12.5px]"
              >
                <span className="flex items-center gap-2">
                  <StatusBadge tone={RESERVATION_RECORD_STATUS_TONE[r.status]}>
                    {RESERVATION_RECORD_STATUS_LABELS[r.status]}
                  </StatusBadge>
                  <span className="tabular-nums">{r.quantity} unit(s)</span>
                </span>
                <span className="text-muted-foreground">
                  {new Date(r.committed_at ?? r.released_at ?? r.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormSection>
  );
}
