import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FormSection } from "@/components/commerce/FormSection";
import { formatMoney } from "@/lib/currency";
import { getOrderShipments } from "@/lib/shipping";
import { createOrderReturn, getOrderExceptions, getOrderReturns } from "@/lib/returns";
import {
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_STATUS_TONE,
  EXCEPTION_TYPE_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONE,
  RETURN_TYPES,
  RETURN_TYPE_LABELS,
} from "@/types/returns";
import type { OrderReturnType } from "@/types/returns";
import type { OrderWithDetails } from "@/types/orders";

/**
 * Delivery problems and returns for one order. Courier-driven records appear
 * here automatically; operators can also open a return manually, for example
 * when a customer sends goods back themselves.
 */
export function OrderReturnsPanel({
  order,
  canManage,
}: {
  order: OrderWithDetails;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);

  const { data: exceptions = [] } = useQuery({
    queryKey: ["order-exceptions", order.id],
    queryFn: () => getOrderExceptions(order.id),
  });

  const { data: returns = [] } = useQuery({
    queryKey: ["order-returns", order.id],
    queryFn: () => getOrderReturns(order.id),
  });

  return (
    <div className="rounded border border-border p-4">
      <FormSection
        title="Delivery exceptions & returns"
        description="Incidents reported by couriers and goods coming back to the warehouse."
      >
        {exceptions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No delivery exceptions.</p>
        ) : (
          <ul className="space-y-2">
            {exceptions.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-2 text-[13px]"
              >
                <StatusBadge tone={EXCEPTION_STATUS_TONE[item.status]}>
                  {EXCEPTION_STATUS_LABELS[item.status]}
                </StatusBadge>
                <span className="font-medium">
                  {EXCEPTION_TYPE_LABELS[item.exception_type]}
                </span>
                <span className="text-muted-foreground">
                  {item.courier_reason ?? item.reason ?? "No reason reported"}
                </span>
                {item.collected_amount != null && (
                  <span className="text-muted-foreground">
                    Collected {formatMoney(item.collected_amount)}
                  </span>
                )}
                <Link
                  to="/orders/exceptions"
                  className="ml-auto text-[12px] text-primary hover:underline"
                >
                  Exceptions queue
                </Link>
              </li>
            ))}
          </ul>
        )}

        {returns.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No returns for this order.</p>
        ) : (
          <ul className="space-y-2">
            {returns.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-2 text-[13px]"
              >
                <StatusBadge tone={RETURN_STATUS_TONE[item.status]}>
                  {RETURN_STATUS_LABELS[item.status]}
                </StatusBadge>
                <Link
                  to="/returns/$id"
                  params={{ id: item.id }}
                  className="font-medium text-primary hover:underline"
                >
                  {item.return_number}
                </Link>
                <span className="text-muted-foreground">
                  {RETURN_TYPE_LABELS[item.return_type]} · {item.item_count} line
                  {item.item_count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Open a return
          </Button>
        )}
      </FormSection>

      {open && (
        <CreateReturnDialog order={order} onOpenChange={setOpen} />
      )}
    </div>
  );
}

function CreateReturnDialog({
  order,
  onOpenChange,
}: {
  order: OrderWithDetails;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [returnType, setReturnType] = useState<OrderReturnType>("customer_return");
  const [shipmentId, setShipmentId] = useState<string>("none");
  const [reason, setReason] = useState("");
  const [tracking, setTracking] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const { data: shipments = [] } = useQuery({
    queryKey: ["order-shipments", order.id],
    queryFn: () => getOrderShipments(order.id),
  });

  const mutation = useMutation({
    mutationFn: () =>
      createOrderReturn({
        orderId: order.id,
        shipmentId: shipmentId === "none" ? null : shipmentId,
        returnType,
        reason: reason || null,
        trackingReference: tracking || null,
        items: order.items.map((item) => ({
          orderItemId: item.id,
          quantityExpected: Number(quantities[item.id] ?? 0) || 0,
        })),
      }),
    onSuccess: () => {
      toast.success("Return opened.");
      queryClient.invalidateQueries({ queryKey: ["order-returns", order.id] });
      queryClient.invalidateQueries({ queryKey: ["return-queue"] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const total = order.items.reduce(
    (sum, item) => sum + (Number(quantities[item.id] ?? 0) || 0),
    0,
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Open a return</DialogTitle>
          <DialogDescription>
            Record what you expect back. Actual quantities are counted later, on arrival.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Return type</Label>
              <Select
                value={returnType}
                onValueChange={(value) => setReturnType(value as OrderReturnType)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {RETURN_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Related shipment</Label>
              <Select value={shipmentId} onValueChange={setShipmentId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked to a shipment</SelectItem>
                  {shipments.map((shipment) => (
                    <SelectItem key={shipment.id} value={shipment.id}>
                      {shipment.shipment_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-tracking">Return tracking (optional)</Label>
            <Input
              id="return-tracking"
              className="h-9"
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-reason">Reason</Label>
            <Textarea
              id="return-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why are these goods coming back?"
            />
          </div>

          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Ordered</th>
                  <th className="px-3 py-2 font-medium">Expected back</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.product_name}</div>
                      {item.variant_name && (
                        <div className="text-[12px] text-muted-foreground">
                          {item.variant_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2">
                      <Input
                        className="h-8 w-20"
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={quantities[item.id] ?? ""}
                        onChange={(event) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={total === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Opening…" : "Open return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
