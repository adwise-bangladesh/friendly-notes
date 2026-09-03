import { useQuery } from "@tanstack/react-query";
import { FormSection } from "@/components/commerce/FormSection";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import { getOrderProfitability, getShipmentProfitability } from "@/lib/finance";
import {
  PROFIT_STATUS_LABELS,
  PROFIT_STATUS_TONE,
  type OrderProfitability,
  type ProfitStatus,
  type ShipmentProfitability,
} from "@/types/finance";

/**
 * Estimated vs realized profit.
 *
 * Estimated is what the order was expected to earn using the price and cost
 * snapshots frozen on the order lines. Realized is money actually collected
 * by the courier minus costs actually consumed (delivered, lost and damaged
 * units, less cost recovered by accepted returns) and courier charges actually
 * recorded. The database derives both; nothing is calculated here.
 */

function num(v: number | null | undefined): number {
  return typeof v === "number" ? v : 0;
}

function Row({
  label,
  value,
  strong,
  money = true,
  muted,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
  money?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={[
          "tabular-nums",
          strong ? "font-semibold" : "",
          muted ? "text-muted-foreground" : "text-foreground",
        ].join(" ")}
      >
        {value === null ? "—" : money ? formatMoney(value) : value.toLocaleString()}
      </span>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border p-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function StatusChip({ status }: { status: ProfitStatus }) {
  return (
    <StatusBadge tone={PROFIT_STATUS_TONE[status] ?? "neutral"}>
      {PROFIT_STATUS_LABELS[status] ?? status}
    </StatusBadge>
  );
}

function Missing({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <p className="mt-2 text-[11.5px] text-warning-foreground">
      Realized profit is still provisional: {items.join("; ")}.
    </p>
  );
}

function Difference({ value }: { value: number }) {
  const tone = value > 0 ? "success" : value < 0 ? "danger" : "neutral";
  return (
    <StatusBadge tone={tone}>
      {value > 0 ? "+" : ""}
      {formatMoney(value)} vs estimate
    </StatusBadge>
  );
}

/* ------------------------------- Order ------------------------------- */

export function OrderProfitabilityPanel({ orderId }: { orderId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["order-profitability", orderId],
    queryFn: () => getOrderProfitability(orderId),
  });

  if (isLoading) {
    return (
      <FormSection title="Profit & loss">
        <p className="text-[13px] text-muted-foreground">Loading profitability…</p>
      </FormSection>
    );
  }
  if (error || !data) {
    return (
      <FormSection title="Profit & loss">
        <p className="text-[13px] text-destructive">
          {error instanceof Error ? error.message : "Profitability is unavailable."}
        </p>
      </FormSection>
    );
  }

  const p: OrderProfitability = data;

  return (
    <FormSection
      title="Profit & loss"
      description="Estimated is the projection from frozen order snapshots. Realized is money actually collected and costs actually incurred."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusChip status={p.profit_status} />
        <StatusBadge tone={PROFIT_STATUS_TONE[p.reconciliation_status] ?? "neutral"}>
          Settlement · {PROFIT_STATUS_LABELS[p.reconciliation_status] ?? p.reconciliation_status}
        </StatusBadge>
        <Difference value={p.difference} />
        {!p.cost_snapshot_complete && <StatusBadge tone="warning">Cost snapshot incomplete</StatusBadge>}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Box title="Estimated (at order time)">
          <Row label="Revenue" value={p.estimated.revenue} />
          <Row label="Product cost" value={p.estimated.product_cost} />
          <Row label="Courier cost" value={p.estimated.courier_cost} />
          <Row label="Packing cost" value={p.estimated.packing_cost} />
          <div className="mt-1 border-t border-border pt-1">
            <Row label="Estimated profit" value={p.estimated.profit} strong />
          </div>
        </Box>

        <Box title="Realized (actual money)">
          <Row label="Collected" value={p.realized.revenue} />
          <Row label="Product cost consumed" value={p.realized.product_cost} />
          <Row label="Courier delivery fee" value={p.realized.delivery_fee} />
          <Row label="COD fee" value={p.realized.cod_fee} />
          <Row label="Return charge" value={p.realized.return_charge} />
          <Row label="Other courier charge" value={p.realized.other_courier_charge} />
          <Row label="Packing cost" value={p.realized.packing_cost} />
          <Row label="Refunds" value={p.realized.refund_amount} />
          <Row label="Adjustments (income)" value={p.realized.adjustment_income} />
          <Row label="Adjustments (expense)" value={p.realized.adjustment_expense} />
          <div className="mt-1 border-t border-border pt-1">
            <Row label="Realized profit" value={p.realized.profit} strong />
          </div>
        </Box>

        <Box title="Units">
          <Row label="Ordered" value={p.quantities.ordered} money={false} />
          <Row label="Shipped" value={p.quantities.shipped} money={false} />
          <Row label="Delivered" value={p.quantities.delivered} money={false} />
          <Row label="Refused" value={p.quantities.refused} money={false} />
          <Row label="Lost" value={p.quantities.lost} money={false} />
          <Row label="Damaged" value={p.quantities.damaged} money={false} />
          <Row label="Returns accepted" value={p.quantities.returned_accepted} money={false} />
          <Row
            label="Open discrepancy"
            value={p.realized.open_discrepancy_amount}
          />
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Lost and damaged units keep their product cost; only accepted returns recover it.
          </p>
        </Box>
      </div>

      <Missing items={p.missing} />

      {p.shipments.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Per shipment
          </p>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Shipment</th>
                  <th className="px-2 py-1.5 text-right font-medium">Delivered</th>
                  <th className="px-2 py-1.5 text-right font-medium">Est. profit</th>
                  <th className="px-2 py-1.5 text-right font-medium">Realized profit</th>
                  <th className="px-2 py-1.5 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {p.shipments.map((s) => (
                  <tr key={s.shipment_id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">{s.shipment_number}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.quantities.delivered}/{s.quantities.shipped}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatMoney(s.estimated.profit)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {s.profit_status === "estimated" ? "—" : formatMoney(s.realized.profit)}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusChip status={s.profit_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Shipment profit attributes order discount and shipping revenue pro rata on line value.
            Order-level adjustments, refunds and packing stay at order level, so shipment rows will
            not always add up to the order figure.
          </p>
        </div>
      )}
    </FormSection>
  );
}

/* ------------------------------ Shipment ------------------------------ */

export function ShipmentProfitabilityPanel({ shipmentId }: { shipmentId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["shipment-profitability", shipmentId],
    queryFn: () => getShipmentProfitability(shipmentId),
  });

  if (isLoading) {
    return (
      <FormSection title="Shipment profit & loss">
        <p className="text-[13px] text-muted-foreground">Loading profitability…</p>
      </FormSection>
    );
  }
  if (error || !data) {
    return (
      <FormSection title="Shipment profit & loss">
        <p className="text-[13px] text-destructive">
          {error instanceof Error ? error.message : "Profitability is unavailable."}
        </p>
      </FormSection>
    );
  }

  const s: ShipmentProfitability = data;
  const realizedKnown = s.profit_status !== "estimated";

  return (
    <FormSection
      title="Shipment profit & loss"
      description="Revenue and cost attributed to this shipment from its own delivered, lost and damaged quantities."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusChip status={s.profit_status} />
        {realizedKnown && <Difference value={s.realized.profit - s.estimated.profit} />}
        {s.open_discrepancies > 0 && (
          <StatusBadge tone="danger">{s.open_discrepancies} open discrepancy</StatusBadge>
        )}
        {!s.cost_snapshot_complete && (
          <StatusBadge tone="warning">Cost snapshot incomplete</StatusBadge>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Box title="Estimated">
          <Row label="Attributed revenue" value={s.estimated.attributed_revenue} />
          <Row label="Product cost shipped" value={s.estimated.attributed_product_cost} />
          <Row label="Expected courier fee" value={s.estimated.expected_delivery_fee} />
          <Row label="Expected COD" value={s.estimated.expected_cod} />
          <div className="mt-1 border-t border-border pt-1">
            <Row label="Estimated profit" value={s.estimated.profit} strong />
          </div>
        </Box>

        <Box title="Realized">
          <Row label="Delivered value" value={s.realized.attributed_revenue} />
          <Row label="Collected" value={s.realized.collected_amount} />
          <Row label="Product cost consumed" value={s.realized.attributed_product_cost} />
          <Row label="Courier delivery fee" value={s.realized.actual_delivery_fee} />
          <Row label="COD fee" value={s.realized.actual_cod_fee} />
          <Row label="Return charge" value={s.realized.actual_return_charge} />
          <Row label="Other charge" value={s.realized.actual_other_charge} />
          <Row label="Shipment adjustments" value={num(s.realized.adjustment)} />
          <div className="mt-1 border-t border-border pt-1">
            <Row
              label={realizedKnown ? "Realized profit" : "Realized profit (not started)"}
              value={realizedKnown ? s.realized.profit : null}
              strong
            />
          </div>
        </Box>

        <Box title="Units">
          <Row label="Shipped" value={s.quantities.shipped} money={false} />
          <Row label="Delivered" value={s.quantities.delivered} money={false} />
          <Row label="Refused" value={s.quantities.refused} money={false} />
          <Row label="Lost" value={s.quantities.lost} money={false} />
          <Row label="Damaged" value={s.quantities.damaged} money={false} />
          <Row label="Return declared" value={s.quantities.return_declared} money={false} />
          <Row label="Return received" value={s.quantities.return_received} money={false} />
          <Row label="Return accepted" value={s.quantities.return_accepted} money={false} />
        </Box>
      </div>

      <Missing items={s.missing} />
    </FormSection>
  );
}
