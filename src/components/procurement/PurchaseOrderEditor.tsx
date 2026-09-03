import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { ProcurementItemPicker } from "./ProcurementItemPicker";
import { formatCurrencyAmount, PROCUREMENT_CURRENCIES } from "@/lib/currency";
import { getActiveSuppliers, getSupplierProducts, savePurchaseOrder } from "@/lib/procurement";
import type { StockableItemOption } from "@/lib/procurement";
import {
  calculatePurchaseOrderTotals,
  poLineTotal,
} from "@/types/procurement";
import type {
  DraftPurchaseOrderItem,
  PurchaseOrderCharges,
  PurchaseOrderDetail,
} from "@/types/procurement";
import { Package } from "lucide-react";

const todayIso = () => new Date().toISOString().slice(0, 10);

function numberOrZero(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function PurchaseOrderEditor({ existing }: { existing?: PurchaseOrderDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [supplierId, setSupplierId] = useState(existing?.supplier_id ?? "");
  const [orderDate, setOrderDate] = useState(existing?.order_date ?? todayIso());
  const [expectedDate, setExpectedDate] = useState(existing?.expected_delivery_date ?? "");
  const [currency, setCurrency] = useState(existing?.currency ?? "BDT");
  const [exchangeRate, setExchangeRate] = useState(
    existing?.exchange_rate === null || existing?.exchange_rate === undefined
      ? "1"
      : String(existing.exchange_rate),
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [charges, setCharges] = useState<PurchaseOrderCharges>({
    discountTotal: existing?.discount_total ?? 0,
    shippingCost: existing?.shipping_cost ?? 0,
    dutyCost: existing?.duty_cost ?? 0,
    otherCost: existing?.other_cost ?? 0,
  });
  const [items, setItems] = useState<DraftPurchaseOrderItem[]>(
    (existing?.items ?? []).map((i) => ({
      key: i.id,
      productId: i.product_id,
      variantId: i.variant_id,
      displayName: i.product_name_snapshot,
      variantName: i.variant_name_snapshot,
      sku: i.sku_snapshot,
      quantityOrdered: i.quantity_ordered,
      unitCost: i.unit_cost,
      discountAmount: i.discount_amount,
      taxAmount: i.tax_amount,
    })),
  );
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers", "active"],
    queryFn: () => getActiveSuppliers(),
  });

  const catalogueQuery = useQuery({
    queryKey: ["supplier-products", supplierId],
    queryFn: () => getSupplierProducts(supplierId),
    enabled: supplierId !== "",
  });

  /** Supplier-specific costs pre-fill new lines so buyers don't retype them. */
  const supplierCosts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of catalogueQuery.data ?? []) {
      const key = row.variant_id ?? row.product_id ?? "";
      if (key && row.last_purchase_cost !== null) map.set(key, Number(row.last_purchase_cost));
    }
    return map;
  }, [catalogueQuery.data]);

  const usedKeys = useMemo(
    () => new Set(items.map((i) => i.variantId ?? i.productId ?? "")),
    [items],
  );

  const totals = useMemo(() => calculatePurchaseOrderTotals(items, charges), [items, charges]);

  function addItem(option: StockableItemOption) {
    const key = option.variantId ?? option.productId;
    setItems((prev) => [
      ...prev,
      {
        key: `${key}-${prev.length}`,
        productId: option.variantId ? null : option.productId,
        variantId: option.variantId,
        displayName: option.productName,
        variantName: option.variantName,
        sku: option.sku,
        quantityOrdered: 1,
        unitCost: supplierCosts.get(key) ?? option.baseCost ?? 0,
        discountAmount: 0,
        taxAmount: 0,
      },
    ]);
  }

  function patchItem(key: string, patch: Partial<DraftPurchaseOrderItem>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Choose a supplier.");
      if (items.length === 0) throw new Error("Add at least one item.");
      const seen = new Set<string>();
      for (const item of items) {
        if (item.quantityOrdered < 1) throw new Error("Every line needs a quantity of at least 1.");
        if (item.unitCost < 0) throw new Error("Unit cost cannot be negative.");
        const key = item.variantId ?? item.productId ?? "";
        if (seen.has(key)) {
          throw new Error(
            `${item.displayName} appears on more than one line. Combine the quantities into one line.`,
          );
        }
        seen.add(key);
      }
      const rate = Number(exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error("Exchange rate must be above zero.");

      return savePurchaseOrder({
        ...(existing ? { id: existing.id } : {}),
        supplierId,
        orderDate,
        expectedDeliveryDate: expectedDate || null,
        currency,
        exchangeRate: rate,
        notes: notes.trim() || null,
        charges,
        items,
      });
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      void qc.invalidateQueries({ queryKey: ["purchase-order", id] });
      toast.success(existing ? "Purchase order updated" : "Purchase order created");
      void navigate({ to: "/procurement/purchase-orders/$id", params: { id } });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save."),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Supplier &amp; terms</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="po-supplier">Supplier *</Label>
              <Select
                value={supplierId}
                onValueChange={(v) => {
                  setSupplierId(v);
                  const supplier = (suppliersQuery.data ?? []).find((s) => s.id === v);
                  if (supplier) setCurrency(supplier.default_currency);
                }}
              >
                <SelectTrigger id="po-supplier">
                  <SelectValue placeholder="Choose a supplier" />
                </SelectTrigger>
                <SelectContent>
                  {(suppliersQuery.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.supplier_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="po-date">Order date</Label>
              <Input
                id="po-date"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="po-expected">Expected delivery</Label>
              <Input
                id="po-expected"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="po-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="po-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROCUREMENT_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="po-rate">Exchange rate to BDT</Label>
              <Input
                id="po-rate"
                inputMode="decimal"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                disabled={currency === "BDT"}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="po-notes">Notes</Label>
              <Textarea
                id="po-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Payment terms, delivery instructions…"
              />
            </div>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card">
          <header className="border-b border-border px-4 py-2.5">
            <h2 className="text-[13px] font-semibold">Items</h2>
            <p className="text-[12px] text-muted-foreground">
              Only stock-carrying items can be purchased.
            </p>
          </header>
          <div className="border-b border-border p-3">
            <ProcurementItemPicker onAdd={addItem} disabledKeys={usedKeys} />
          </div>

          {items.length === 0 ? (
            <EmptyState compact icon={Package} title="No items yet" description="Search above to add what you are buying." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Item</th>
                    <th className="w-20 px-2 py-2 text-right font-semibold">Qty</th>
                    <th className="w-28 px-2 py-2 text-right font-semibold">Unit cost</th>
                    <th className="w-28 px-2 py-2 text-right font-semibold">Discount</th>
                    <th className="w-24 px-2 py-2 text-right font-semibold">Tax</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">Line total</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">
                          {item.displayName}
                          {item.variantName && (
                            <span className="text-muted-foreground"> — {item.variantName}</span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {item.sku ?? "No SKU"}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-right text-[12.5px]"
                          inputMode="numeric"
                          value={String(item.quantityOrdered)}
                          onChange={(e) =>
                            patchItem(item.key, {
                              quantityOrdered: Math.max(1, Math.round(numberOrZero(e.target.value))),
                            })
                          }
                          aria-label={`Quantity for ${item.displayName}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-right text-[12.5px]"
                          inputMode="decimal"
                          value={String(item.unitCost)}
                          onChange={(e) =>
                            patchItem(item.key, { unitCost: Math.max(0, numberOrZero(e.target.value)) })
                          }
                          aria-label={`Unit cost for ${item.displayName}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-right text-[12.5px]"
                          inputMode="decimal"
                          value={String(item.discountAmount)}
                          onChange={(e) =>
                            patchItem(item.key, {
                              discountAmount: Math.max(0, numberOrZero(e.target.value)),
                            })
                          }
                          aria-label={`Discount for ${item.displayName}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-right text-[12.5px]"
                          inputMode="decimal"
                          value={String(item.taxAmount)}
                          onChange={(e) =>
                            patchItem(item.key, { taxAmount: Math.max(0, numberOrZero(e.target.value)) })
                          }
                          aria-label={`Tax for ${item.displayName}`}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {formatCurrencyAmount(poLineTotal(item), currency)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                          aria-label={`Remove ${item.displayName}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Order charges</h2>
          <div className="space-y-2">
            {(
              [
                ["discountTotal", "Order discount"],
                ["shippingCost", "Inbound shipping"],
                ["dutyCost", "Duty / customs"],
                ["otherCost", "Other cost"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <Label htmlFor={`po-${key}`} className="text-[12.5px] font-normal">
                  {label}
                </Label>
                <Input
                  id={`po-${key}`}
                  className="h-7 w-28 text-right text-[12.5px]"
                  inputMode="decimal"
                  value={String(charges[key])}
                  onChange={(e) =>
                    setCharges((prev) => ({ ...prev, [key]: Math.max(0, numberOrZero(e.target.value)) }))
                  }
                />
              </div>
            ))}
          </div>

          <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Items subtotal</dt>
              <dd className="tabular-nums">{formatCurrencyAmount(totals.subtotal, currency)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Grand total</dt>
              <dd className="tabular-nums">{formatCurrencyAmount(totals.grandTotal, currency)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Totals are recalculated by the database when the order is saved.
          </p>
        </section>

        {error && (
          <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

        <Button
          className="w-full"
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending
            ? "Saving…"
            : existing
              ? "Save changes"
              : "Create draft purchase order"}
        </Button>
      </aside>
    </div>
  );
}
