import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/commerce/FormSection";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FinancialAdjustmentDialog } from "./FinancialAdjustmentDialog";
import { formatMoney } from "@/lib/currency";
import { getOrderAdjustments, getOrderFinancials, reverseFinancialAdjustment } from "@/lib/finance";
import {
  ADJUSTMENT_DIRECTION_LABELS,
  ADJUSTMENT_TYPE_LABELS,
  COMPLETENESS_LABELS,
  COMPLETENESS_TONE,
} from "@/types/finance";

/**
 * Internal financial view of one order. Estimated and actual figures are kept
 * visually apart, and actual profit is only presented as a fact when every
 * shipment has reported real courier money.
 */
export function OrderFinancialsPanel({
  orderId,
  canManage,
}: {
  orderId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: fin, isLoading } = useQuery({
    queryKey: ["order-financials", orderId],
    queryFn: () => getOrderFinancials(orderId),
  });
  const { data: adjustments = [] } = useQuery({
    queryKey: ["order-adjustments", orderId],
    queryFn: () => getOrderAdjustments(orderId),
  });

  const reverse = useMutation({
    mutationFn: (id: string) => reverseFinancialAdjustment(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["order-financials", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["order-adjustments", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      toast.success("Adjustment reversed");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not reverse"),
  });

  if (isLoading || !fin) {
    return (
      <FormSection title="Financials">
        <p className="text-[13px] text-muted-foreground">Loading financials…</p>
      </FormSection>
    );
  }

  const complete = fin.completeness === "actual";

  return (
    <FormSection
      title="Financials"
      description="Internal only. Costs are the values frozen when the order was placed."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={COMPLETENESS_TONE[fin.completeness]}>
          Financial data · {COMPLETENESS_LABELS[fin.completeness]}
        </StatusBadge>
        {!fin.estimated.cost_snapshot_complete && (
          <StatusBadge tone="warning">Cost snapshot incomplete</StatusBadge>
        )}
        <span className="text-[11.5px] text-muted-foreground">
          {fin.shipments_with_collection}/{fin.shipment_count} shipments reported collection
        </span>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-8"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Adjustment
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Block title="Revenue">
          <Line label="Gross product" value={fin.revenue.gross_product_amount} />
          <Line label="Item discounts" value={-fin.revenue.item_discounts} />
          <Line label="Order discounts" value={-fin.revenue.order_discounts} />
          <Line label="Net product revenue" value={fin.revenue.net_product_revenue} />
          <Line label="Shipping revenue" value={fin.revenue.shipping_revenue} />
          <Line label="Other adjustments" value={fin.revenue.other_adjustments} />
          <Line label="Customer total" value={fin.revenue.customer_total} strong />
        </Block>

        <Block title="Estimated costs">
          <Line label="Product cost" value={fin.estimated.product_cost} />
          <Line label="Delivery cost" value={fin.estimated.delivery_cost} />
          <Line label="Packing cost" value={fin.estimated.packing_cost} />
          <Line label="Estimated profit" value={fin.estimated.profit} strong />
        </Block>

        <Block title="Actual financials">
          <Line label="Collected" value={fin.actual.collected_amount} />
          <Line label="Product cost" value={fin.actual.product_cost} />
          <Line label="Courier charges" value={fin.actual.delivery_cost} />
          <Line label="COD fees" value={fin.actual.cod_fees} />
          <Line label="Return charges" value={fin.actual.return_charges} />
          <Line label="Other courier charges" value={fin.actual.other_courier_charges} />
          <Line label="Packing cost" value={fin.actual.packing_cost} />
          <Line label="Customer refunds" value={fin.actual.refunded_amount} />
          <Line label="Adjustment income" value={fin.actual.adjustment_income} />
          <Line label="Adjustment expense" value={fin.actual.adjustment_expense} />
          <div className="mt-1 border-t border-border pt-1">
            {complete ? (
              <Line label="Actual profit" value={fin.actual.profit} strong />
            ) : (
              <>
                <Line label="Actual profit so far" value={fin.actual.profit} />
                <p className="mt-1 text-[11.5px] text-warning-foreground">
                  Actual financial data incomplete — treat this as provisional.
                </p>
              </>
            )}
          </div>
        </Block>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Block title="Payment">
          <Line label="Expected from customer" value={fin.payment.expected_amount} />
          <Line label="Paid" value={fin.payment.paid_amount} />
          <Line label="Refunded" value={fin.payment.refunded_amount} />
          <Line label="Net retained" value={fin.payment.net_retained} strong />
          <Line label="Still due" value={fin.payment.due_amount} />
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Status: {PAYMENT_STATUS_LABELS[fin.payment.status] ?? fin.payment.status}. Derived from
            recorded money events, not typed in by hand.
          </p>
        </Block>

        <Block title="Returns">
          <Line label="Returned units" value={fin.returns.returned_units} money={false} />
          <Line label="Retained from returns" value={fin.returns.retained_amount} />
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {fin.returns.unresolved > 0
              ? `${fin.returns.unresolved} return(s) still need a financial outcome recorded.`
              : "All returns have a recorded financial outcome."}
            {fin.returns.returned_units > 0 && !fin.returns.cost_recovered
              ? " Returned stock has not been restocked yet, so product cost still counts it."
              : ""}
          </p>
        </Block>

        <Block title="Realization & settlement">
          <Line label="Units ordered" value={fin.realization.units_ordered} money={false} />
          <Line label="Units shipped" value={fin.realization.units_shipped} money={false} />
          <Line
            label="Open discrepancies"
            value={fin.settlement.open_discrepancies}
            money={false}
          />
          <Line label="Open discrepancy amount" value={fin.settlement.open_discrepancy_amount} />
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {fin.settlement.open_discrepancies > 0
              ? "Courier settlement is disputed for part of this order; profit stays provisional until resolved."
              : fin.realization.fully_realized
                ? "Everything ordered has shipped and settled."
                : "Not every ordered unit has shipped yet."}
          </p>
        </Block>
      </div>

      <p className="mt-2 text-[11.5px] text-muted-foreground">
        Shipping margin{" "}
        <span className="tabular-nums text-foreground">{formatMoney(fin.shipping_margin)}</span>{" "}
        (customer shipping charge minus{" "}
        {fin.actual.delivery_cost > 0 ? "actual" : "estimated"} courier cost).
      </p>


      <div className="mt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Adjustments
        </p>
        {adjustments.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No financial adjustments recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Type</th>
                  <th className="px-2 py-1.5 text-left font-medium">Direction</th>
                  <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                  <th className="px-2 py-1.5 text-left font-medium">Reason</th>
                  <th className="px-2 py-1.5 text-left font-medium">Recorded</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">
                      {ADJUSTMENT_TYPE_LABELS[a.adjustment_type]}
                      {a.reversal_of && (
                        <span className="ml-1 text-[11px] text-muted-foreground">(reversal)</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusBadge tone={a.direction === "income" ? "success" : "neutral"}>
                        {ADJUSTMENT_DIRECTION_LABELS[a.direction]}
                      </StatusBadge>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatMoney(Number(a.amount))}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {a.reason ?? "—"}
                      {a.reference && (
                        <span className="ml-1 text-[11px]">· ref {a.reference}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                      {a.reversed_at && <span className="ml-1 text-[11px]">· reversed</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {canManage && !a.reversed_at && !a.reversal_of && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          disabled={reverse.isPending}
                          onClick={() => reverse.mutate(a.id)}
                        >
                          <Undo2 className="mr-1 h-3.5 w-3.5" /> Reverse
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FinancialAdjustmentDialog
        orderId={orderId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </FormSection>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border p-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          strong ? "font-semibold tabular-nums text-foreground" : "tabular-nums text-foreground"
        }
      >
        {formatMoney(Number(value))}
      </span>
    </div>
  );
}
