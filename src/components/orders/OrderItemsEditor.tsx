import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
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
import { OrderProductPicker } from "@/components/orders/OrderProductPicker";
import { formatMoney } from "@/lib/currency";
import { updateOrderItems } from "@/lib/orders";
import type { OrderItemEditInput } from "@/lib/orders";
import type { OrderWithDetails } from "@/types/orders";

interface EditableLine {
  key: string;
  id: string | null;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
}

interface Props {
  order: OrderWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Controlled correction of an order's contents before any warehouse or courier
 * work exists. Everything is sent to `update_order_items`, which recalculates
 * the totals, rebuilds reservations and writes the audit note — the browser
 * never touches order tables directly.
 */
export function OrderItemsEditor({ order, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<EditableLine[]>(() => toLines(order));
  const [orderDiscount, setOrderDiscount] = useState(String(order.order_discount ?? 0));
  const [shippingCharge, setShippingCharge] = useState(String(order.shipping_charge ?? 0));
  const [reason, setReason] = useState("");

  function reset() {
    setLines(toLines(order));
    setOrderDiscount(String(order.order_discount ?? 0));
    setShippingCharge(String(order.shipping_charge ?? 0));
    setReason("");
  }

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * l.unitPrice - l.discountAmount, 0),
    [lines],
  );
  const projectedTotal =
    subtotal - Number(orderDiscount || 0) + Number(shippingCharge || 0) + Number(order.adjustment ?? 0);

  const mutation = useMutation({
    mutationFn: () =>
      updateOrderItems({
        orderId: order.id,
        items: lines.map<OrderItemEditInput>((l) => ({
          id: l.id,
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
          discountAmount: l.discountAmount,
          unitPrice: l.unitPrice,
        })),
        orderDiscount: Number(orderDiscount || 0),
        shippingCharge: Number(shippingCharge || 0),
        reason,
      }),
    onSuccess: () => {
      toast.success("Order updated");
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["order-notes", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      onOpenChange(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not update this order"),
  });

  const canSave = lines.length > 0 && lines.every((l) => l.productId !== "" && l.quantity >= 1 && l.unitPrice >= 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct order items</DialogTitle>
          <DialogDescription>
            Only possible while no fulfillment, shipment or return exists. The change is recorded on
            the order timeline and any stock reservation is rebuilt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Product</th>
                  <th className="w-20 px-2 text-right font-medium">Qty</th>
                  <th className="w-28 px-2 text-right font-medium">Unit price</th>
                  <th className="w-28 px-2 text-right font-medium">Discount</th>
                  <th className="w-24 px-2 text-right font-medium">Line</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-2">
                      {line.productName}
                      {line.variantName && (
                        <span className="text-muted-foreground"> · {line.variantName}</span>
                      )}
                    </td>
                    <td className="px-2">
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        aria-label={`Quantity for ${line.productName}`}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) }
                                : l,
                            ),
                          )
                        }
                        className="h-8 text-right"
                      />
                    </td>
                    <td className="px-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        aria-label={`Unit price for ${line.productName}`}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, unitPrice: Math.max(0, Number(e.target.value) || 0) }
                                : l,
                            ),
                          )
                        }
                        className="h-8 text-right"
                      />
                    </td>
                    <td className="px-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.discountAmount}
                        aria-label={`Discount for ${line.productName}`}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key
                                ? { ...l, discountAmount: Math.max(0, Number(e.target.value) || 0) }
                                : l,
                            ),
                          )
                        }
                        className="h-8 text-right"
                      />
                    </td>
                    <td className="px-2 text-right tabular-nums">
                      {formatMoney(line.quantity * line.unitPrice - line.discountAmount)}
                    </td>
                    <td className="pl-2 text-right">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Remove ${line.productName}`}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 text-center text-muted-foreground">
                      An order must keep at least one product.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <OrderProductPicker
            onAdd={(item) =>
              setLines((prev) => {
                const existing = prev.find(
                  (l) => l.productId === item.productId && l.variantId === item.variantId,
                );
                if (existing) {
                  return prev.map((l) =>
                    l.key === existing.key ? { ...l, quantity: l.quantity + item.quantity } : l,
                  );
                }
                return [
                  ...prev,
                  {
                    key: `new-${item.productId}-${item.variantId ?? "base"}`,
                    id: null,
                    productId: item.productId,
                    variantId: item.variantId,
                    productName: item.productName,
                    variantName: item.variantName,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    discountAmount: item.discountAmount,
                  },
                ];
              })
            }
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="order-discount">Order discount</Label>
              <Input
                id="order-discount"
                type="number"
                min={0}
                step="0.01"
                value={orderDiscount}
                onChange={(e) => setOrderDiscount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shipping-charge">Shipping charge</Label>
              <Input
                id="shipping-charge"
                type="number"
                min={0}
                step="0.01"
                value={shippingCharge}
                onChange={(e) => setShippingCharge(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-reason">Why is this changing?</Label>
            <Textarea
              id="edit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Customer asked for one extra piece on the confirmation call"
              rows={2}
            />
          </div>

          <p className="text-[12.5px] text-muted-foreground">
            New total (indicative): <span className="tabular-nums">{formatMoney(projectedTotal)}</span>{" "}
            — the database recalculates the final amount.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLines(order: OrderWithDetails): EditableLine[] {
  return order.items.map((item) => ({
    key: item.id,
    id: item.id,
    productId: item.product_id ?? "",
    variantId: item.variant_id,
    productName: item.product_name,
    variantName: item.variant_name,
    quantity: item.quantity,
    unitPrice: Number(item.unit_price),
    discountAmount: Number(item.discount_amount ?? 0),
  }));
}
