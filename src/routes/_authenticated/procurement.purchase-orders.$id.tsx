import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { PurchaseOrderEditor } from "@/components/procurement/PurchaseOrderEditor";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatCurrencyAmount } from "@/lib/currency";
import { getLocations } from "@/lib/inventory";
import {
  createGoodsReceipt,
  finalizeGoodsReceipt,
  getPurchaseOrder,
  setGoodsReceiptLines,
  setPurchaseOrderStatus,
} from "@/lib/procurement";
import {
  canApprove,
  canCancelPurchaseOrder,
  canClose,
  canEditPurchaseOrder,
  canMarkOrdered,
  canReceiveGoods,
  canSubmitForApproval,
  PO_EVENT_LABELS,
  PO_STATUS_LABELS,
  PO_STATUS_MEANING,
  PO_STATUS_TONE,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_TONE,
  receiveLineError,
  remainingQuantity,
} from "@/types/procurement";
import type { PurchaseOrderStatus, ReceiveLineDraft } from "@/types/procurement";

const TITLE = "Purchase Order · Commerce Operations";
const DESCRIPTION = "Purchase order detail, approvals, receiving and full procurement history.";

export const Route = createFileRoute("/_authenticated/procurement/purchase-orders/$id")({
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
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const perms = useCommercePermissions();
  const [editing, setEditing] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<Record<string, { received: string; damaged: string }>>({});

  const poQuery = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => getPurchaseOrder(id),
  });

  const locationsQuery = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => getLocations(),
  });

  const po = poQuery.data;

  const receivedTotal = useMemo(
    () => (po?.items ?? []).reduce((sum, i) => sum + i.quantity_received, 0),
    [po],
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["purchase-order", id] });
    void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    void qc.invalidateQueries({ queryKey: ["inventory"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ status, note }: { status: PurchaseOrderStatus; note?: string }) =>
      setPurchaseOrderStatus(id, status, note),
    onSuccess: () => {
      invalidate();
      toast.success("Purchase order updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update."),
  });

  const receiveMutation = useMutation({
    mutationFn: async () => {
      if (!po) throw new Error("Purchase order not loaded.");
      if (!locationId) throw new Error("Choose the location receiving these goods.");

      const drafts: ReceiveLineDraft[] = [];
      for (const item of po.items) {
        const entry = lines[item.id];
        if (!entry) continue;
        const received = Number(entry.received || "0");
        const damaged = Number(entry.damaged || "0");
        if (received <= 0) continue;
        const err = receiveLineError({ received, damaged }, remainingQuantity(item));
        if (err) throw new Error(`${item.product_name_snapshot}: ${err}`);
        drafts.push({
          purchaseOrderItemId: item.id,
          received,
          damaged,
          notes: "",
        });
      }
      if (drafts.length === 0) throw new Error("Enter at least one received quantity.");

      // One atomic sequence: create, fill, finalise. Finalisation is where the
      // database moves stock through apply_inventory_movement or rolls back.
      const receiptId = await createGoodsReceipt(po.id, locationId);
      await setGoodsReceiptLines(receiptId, drafts);
      await finalizeGoodsReceipt(receiptId);
    },
    onSuccess: () => {
      invalidate();
      setReceiveOpen(false);
      setLines({});
      toast.success("Goods received into inventory");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not receive goods."),
  });

  if (poQuery.isLoading) return <LoadingState rows={6} label="Loading purchase order" />;
  if (!po) {
    return (
      <EmptyState
        title="Purchase order not found"
        action={
          <Button size="sm" variant="outline" asChild>
            <Link to="/procurement/purchase-orders">Back to purchase orders</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={po.purchase_order_number}
        description={PO_STATUS_MEANING[po.status]}
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/procurement/purchase-orders">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Purchase Orders
              </Link>
            </Button>
            {perms.canManage && canEditPurchaseOrder(po.status) && (
              <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
                {editing ? "Stop editing" : "Edit"}
              </Button>
            )}
            {perms.canManage && canSubmitForApproval(po.status) && (
              <Button
                size="sm"
                onClick={() => statusMutation.mutate({ status: "pending_approval" })}
              >
                Submit for approval
              </Button>
            )}
            {perms.canArchive && canApprove(po.status) && (
              <Button size="sm" onClick={() => statusMutation.mutate({ status: "approved" })}>
                Approve
              </Button>
            )}
            {perms.canManage && canMarkOrdered(po.status) && (
              <Button size="sm" onClick={() => statusMutation.mutate({ status: "ordered" })}>
                Mark ordered
              </Button>
            )}
            {perms.canManage && canReceiveGoods(po.status) && (
              <Button size="sm" onClick={() => setReceiveOpen(true)}>
                <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                Receive goods
              </Button>
            )}
            {perms.canManage && canClose(po.status) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => statusMutation.mutate({ status: "closed" })}
              >
                Close
              </Button>
            )}
            {perms.canArchive && canCancelPurchaseOrder(po.status, receivedTotal) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => statusMutation.mutate({ status: "cancelled" })}
              >
                Cancel
              </Button>
            )}
          </>
        }
      />

      {editing ? (
        <PurchaseOrderEditor existing={po} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <section className="rounded-md border border-border bg-card">
              <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h2 className="text-[13px] font-semibold">Items</h2>
                <StatusBadge tone={PO_STATUS_TONE[po.status]}>
                  {PO_STATUS_LABELS[po.status]}
                </StatusBadge>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Ordered</th>
                      <th className="px-3 py-2 text-right font-semibold">Received</th>
                      <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                      <th className="px-3 py-2 text-right font-semibold">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.items.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5">
                          <div className="font-medium">
                            {item.product_name_snapshot}
                            {item.variant_name_snapshot && (
                              <span className="text-muted-foreground">
                                {" "}
                                — {item.variant_name_snapshot}
                              </span>
                            )}
                          </div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {item.sku_snapshot ?? "No SKU"}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {item.quantity_ordered}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {item.quantity_received}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatCurrencyAmount(item.unit_cost, po.currency)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatCurrencyAmount(item.line_total, po.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-md border border-border bg-card">
              <header className="border-b border-border px-4 py-2.5">
                <h2 className="text-[13px] font-semibold">Goods receipts</h2>
              </header>
              {po.receipts.length === 0 ? (
                <EmptyState compact title="Nothing received yet" />
              ) : (
                <ul className="divide-y divide-border">
                  {po.receipts.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div>
                        <span className="font-mono text-[12.5px]">{r.receipt_number}</span>
                        <p className="text-[12px] text-muted-foreground">
                          {r.location?.name ?? "—"} ·{" "}
                          {r.received_at ? new Date(r.received_at).toLocaleString() : "Draft"}
                          {r.reversed_at ? " · reversed" : ""}
                        </p>
                      </div>
                      <StatusBadge tone={RECEIPT_STATUS_TONE[r.status]}>
                        {RECEIPT_STATUS_LABELS[r.status]}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-md border border-border bg-card p-4">
              <h2 className="mb-3 text-[13px] font-semibold">Summary</h2>
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Supplier</dt>
                  <dd className="text-right">
                    {po.supplier ? (
                      <Link
                        to="/suppliers/$id"
                        params={{ id: po.supplier.id }}
                        className="text-primary hover:underline"
                      >
                        {po.supplier_name_snapshot ?? po.supplier.name}
                      </Link>
                    ) : (
                      (po.supplier_name_snapshot ?? "—")
                    )}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Order date</dt>
                  <dd>{po.order_date}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Expected</dt>
                  <dd>{po.expected_delivery_date ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">
                    {formatCurrencyAmount(po.subtotal, po.currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Shipping / duty / other</dt>
                  <dd className="tabular-nums">
                    {formatCurrencyAmount(
                      po.shipping_cost + po.duty_cost + po.other_cost,
                      po.currency,
                    )}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                  <dt>Grand total</dt>
                  <dd className="tabular-nums">
                    {formatCurrencyAmount(po.grand_total, po.currency)}
                  </dd>
                </div>
              </dl>
              {po.notes && (
                <p className="mt-3 border-t border-border pt-3 text-[12.5px] text-muted-foreground">
                  {po.notes}
                </p>
              )}
            </section>

            <section className="rounded-md border border-border bg-card">
              <header className="border-b border-border px-4 py-2.5">
                <h2 className="text-[13px] font-semibold">History</h2>
              </header>
              <ul className="divide-y divide-border">
                {po.events.map((e) => (
                  <li key={e.id} className="px-4 py-2">
                    <p className="text-[12.5px] font-medium">{PO_EVENT_LABELS[e.event_type]}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                      {e.message ? ` · ${e.message}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receive goods</DialogTitle>
            <DialogDescription>
              Accepted units enter sellable stock; damaged units are recorded as damaged and never
              become sellable. Everything is applied atomically.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="grn-location">Receiving location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger id="grn-location">
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent>
                {(locationsQuery.data ?? [])
                  .filter((l) => l.status === "active")
                  .map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="max-h-72 overflow-y-auto rounded border border-border">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Item</th>
                  <th className="w-20 px-2 py-2 text-right font-semibold">Remaining</th>
                  <th className="w-24 px-2 py-2 text-right font-semibold">Received</th>
                  <th className="w-24 px-2 py-2 text-right font-semibold">Damaged</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((item) => {
                  const remaining = remainingQuantity(item);
                  const entry = lines[item.id] ?? { received: "", damaged: "" };
                  return (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-1.5">
                        {item.product_name_snapshot}
                        {item.variant_name_snapshot && (
                          <span className="text-muted-foreground">
                            {" "}
                            — {item.variant_name_snapshot}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{remaining}</td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-right text-[12.5px]"
                          inputMode="numeric"
                          disabled={remaining === 0}
                          value={entry.received}
                          onChange={(e) =>
                            setLines((prev) => ({
                              ...prev,
                              [item.id]: { ...entry, received: e.target.value },
                            }))
                          }
                          aria-label={`Received quantity for ${item.product_name_snapshot}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-right text-[12.5px]"
                          inputMode="numeric"
                          disabled={remaining === 0}
                          value={entry.damaged}
                          onChange={(e) =>
                            setLines((prev) => ({
                              ...prev,
                              [item.id]: { ...entry, damaged: e.target.value },
                            }))
                          }
                          aria-label={`Damaged quantity for ${item.product_name_snapshot}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReceiveOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={receiveMutation.isPending}
              onClick={() => receiveMutation.mutate()}
            >
              {receiveMutation.isPending ? "Receiving…" : "Receive into inventory"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
