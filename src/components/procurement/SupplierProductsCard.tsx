import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Package, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProcurementItemPicker } from "./ProcurementItemPicker";
import { CostHistoryDialog } from "./CostHistoryDialog";
import { formatCurrencyAmount } from "@/lib/currency";
import {
  deleteSupplierProduct,
  getSupplierProducts,
  saveSupplierProduct,
} from "@/lib/procurement";
import type { StockableItemOption } from "@/lib/procurement";
import type { SupplierProductWithItem } from "@/types/procurement";

interface Draft {
  id?: string;
  productId: string | null;
  variantId: string | null;
  label: string;
  supplierSku: string;
  supplierProductName: string;
  lastPurchaseCost: string;
  minimumOrderQuantity: string;
  leadTimeDays: string;
  isPreferred: boolean;
  notes: string;
}

export function SupplierProductsCard({
  supplierId,
  currency,
  canManage,
}: {
  supplierId: string;
  currency: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [historyTarget, setHistoryTarget] = useState<SupplierProductWithItem | null>(null);

  const productsQuery = useQuery({
    queryKey: ["supplier-products", supplierId],
    queryFn: () => getSupplierProducts(supplierId),
  });

  const rows = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const usedKeys = useMemo(
    () => new Set(rows.map((r) => r.variant_id ?? r.product_id ?? "")),
    [rows],
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["supplier-products", supplierId] });
    void qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: Draft) => {
      const cost = values.lastPurchaseCost.trim() ? Number(values.lastPurchaseCost) : null;
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
        throw new Error("Cost must be zero or more.");
      }
      const moq = Number(values.minimumOrderQuantity || "1");
      if (!Number.isFinite(moq) || moq < 1) throw new Error("Minimum order quantity must be at least 1.");
      const lead = values.leadTimeDays.trim() ? Number(values.leadTimeDays) : null;
      if (lead !== null && (!Number.isFinite(lead) || lead < 0)) {
        throw new Error("Lead time cannot be negative.");
      }
      await saveSupplierProduct({
        ...(values.id ? { id: values.id } : {}),
        supplier_id: supplierId,
        product_id: values.productId,
        variant_id: values.variantId,
        supplier_sku: values.supplierSku.trim() || null,
        supplier_product_name: values.supplierProductName.trim() || null,
        last_purchase_cost: cost,
        currency,
        minimum_order_quantity: Math.round(moq),
        lead_time_days: lead === null ? null : Math.round(lead),
        is_preferred: values.isPreferred,
        notes: values.notes.trim() || null,
      });
    },
    onSuccess: () => {
      invalidate();
      setDraft(null);
      toast.success("Supplier item saved");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save item."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSupplierProduct(id),
    onSuccess: () => {
      invalidate();
      toast.success("Item unlinked");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not unlink."),
  });

  function startFromItem(item: StockableItemOption) {
    setDraft({
      productId: item.variantId ? null : item.productId,
      variantId: item.variantId,
      label: item.variantName ? `${item.productName} — ${item.variantName}` : item.productName,
      supplierSku: item.sku ?? "",
      supplierProductName: "",
      lastPurchaseCost: item.baseCost === null ? "" : String(item.baseCost),
      minimumOrderQuantity: "1",
      leadTimeDays: "",
      isPreferred: false,
      notes: "",
    });
  }

  function itemLabel(row: SupplierProductWithItem): string {
    if (row.variant) {
      return `${row.variant.product?.name ?? "Product"} — ${row.variant.title}`;
    }
    return row.product?.name ?? "Product";
  }

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Supplied items</h2>
        <p className="text-[12px] text-muted-foreground">
          What this supplier sells you, their SKU, cost and lead time.
        </p>
      </header>

      {canManage && (
        <div className="border-b border-border p-3">
          <ProcurementItemPicker onAdd={startFromItem} disabledKeys={usedKeys} />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Package}
          title="No linked items"
          description="Link the products you buy from this supplier to speed up purchase orders."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-left font-semibold">Supplier SKU</th>
                <th className="px-3 py-2 text-right font-semibold">Last cost</th>
                <th className="px-3 py-2 text-right font-semibold">MOQ</th>
                <th className="px-3 py-2 text-right font-semibold">Lead time</th>
                <th className="w-24 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{itemLabel(row)}</span>
                      {row.is_preferred && (
                        <StatusBadge tone="success">
                          <Star className="mr-1 h-3 w-3" />
                          Preferred
                        </StatusBadge>
                      )}
                    </div>
                    {row.supplier_product_name && (
                      <div className="text-[11.5px] text-muted-foreground">
                        Supplier name: {row.supplier_product_name}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-muted-foreground">
                    {row.supplier_sku ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatCurrencyAmount(row.last_purchase_cost, row.currency)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.minimum_order_quantity}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.lead_time_days === null ? "—" : `${row.lead_time_days} d`}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setHistoryTarget(row)}
                      aria-label="Cost history"
                    >
                      <History className="h-3.5 w-3.5" />
                    </Button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => deleteMutation.mutate(row.id)}
                        aria-label="Unlink item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link item to supplier</DialogTitle>
            <DialogDescription>{draft?.label}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sp-sku">Supplier SKU</Label>
                <Input
                  id="sp-sku"
                  value={draft.supplierSku}
                  onChange={(e) => setDraft({ ...draft, supplierSku: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="sp-name">Supplier item name</Label>
                <Input
                  id="sp-name"
                  value={draft.supplierProductName}
                  onChange={(e) => setDraft({ ...draft, supplierProductName: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="sp-cost">Last purchase cost ({currency})</Label>
                <Input
                  id="sp-cost"
                  inputMode="decimal"
                  value={draft.lastPurchaseCost}
                  onChange={(e) => setDraft({ ...draft, lastPurchaseCost: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="sp-moq">Minimum order qty</Label>
                <Input
                  id="sp-moq"
                  inputMode="numeric"
                  value={draft.minimumOrderQuantity}
                  onChange={(e) => setDraft({ ...draft, minimumOrderQuantity: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="sp-lead">Lead time (days)</Label>
                <Input
                  id="sp-lead"
                  inputMode="numeric"
                  value={draft.leadTimeDays}
                  onChange={(e) => setDraft({ ...draft, leadTimeDays: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="sp-notes">Notes</Label>
                <Input
                  id="sp-notes"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
                <Checkbox
                  checked={draft.isPreferred}
                  onCheckedChange={(v) => setDraft({ ...draft, isPreferred: v === true })}
                />
                Preferred supplier for this item
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saveMutation.isPending}
              onClick={() => draft && saveMutation.mutate(draft)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CostHistoryDialog
        open={historyTarget !== null}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        title={historyTarget ? itemLabel(historyTarget) : ""}
        productId={historyTarget?.product_id ?? null}
        variantId={historyTarget?.variant_id ?? null}
      />
    </section>
  );
}
