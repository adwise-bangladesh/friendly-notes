import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { ProcurementItemPicker } from "@/components/procurement/ProcurementItemPicker";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  getTransfer,
  getTransferItems,
  setTransferItems,
  setTransferStatus,
} from "@/lib/inventory-ops";
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUS_TONE } from "@/types/inventory";
import type { StockableItemOption } from "@/lib/procurement";

const TITLE = "Transfer · Commerce Operations";
const DESCRIPTION = "Review, dispatch and receive a stock transfer between locations.";

export const Route = createFileRoute("/_authenticated/inventory/transfers_/$id")({
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
  errorComponent: () => (
    <p className="px-4 py-6 text-center text-[13px] text-destructive">
      This transfer could not be loaded.
    </p>
  ),
  notFoundComponent: () => (
    <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Transfer not found.</p>
  ),
});

interface DraftLine {
  key: string;
  productId: string | null;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string | null;
  quantity: string;
}

function Page() {
  const { id } = Route.useParams();
  const perms = useCommercePermissions();
  const qc = useQueryClient();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const transferQuery = useQuery({
    queryKey: ["inventory-transfer", id],
    queryFn: () => getTransfer(id),
  });
  const itemsQuery = useQuery({
    queryKey: ["inventory-transfer-items", id],
    queryFn: () => getTransferItems(id),
  });

  const transfer = transferQuery.data;
  const items = itemsQuery.data ?? [];
  const isDraft = transfer?.status === "draft";

  useEffect(() => {
    if (!isDraft) return;
    setLines(
      items.map((i) => ({
        key: i.variant_id ?? i.product_id ?? i.id,
        productId: i.product_id,
        variantId: i.variant_id,
        name: i.product_name_snapshot,
        variantName: i.variant_name_snapshot,
        sku: i.sku_snapshot,
        quantity: String(i.requested_quantity),
      })),
    );
  }, [isDraft, items]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-transfer", id] });
    void qc.invalidateQueries({ queryKey: ["inventory-transfer-items", id] });
    void qc.invalidateQueries({ queryKey: ["inventory-transfers"] });
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["inventory-ledger"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = lines.map((l) => {
        const qty = Number.parseInt(l.quantity, 10);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`Enter a quantity greater than zero for ${l.name}.`);
        }
        return { productId: l.productId, variantId: l.variantId, requestedQuantity: qty };
      });
      if (payload.length === 0) throw new Error("Add at least one item.");
      await setTransferItems(id, payload);
    },
    onSuccess: () => {
      refresh();
      setError(null);
      toast.success("Items saved");
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not save the items."),
  });

  const statusMutation = useMutation({
    mutationFn: async (input: { status: Parameters<typeof setTransferStatus>[1]; reason?: string }) =>
      setTransferStatus(id, input.status, input.reason ?? null),
    onSuccess: () => {
      refresh();
      setError(null);
      setCancelReason("");
      toast.success("Transfer updated");
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not update the transfer."),
  });

  const addItem = (item: StockableItemOption) => {
    const key = item.variantId ?? item.productId;
    if (lines.some((l) => l.key === key)) return;
    setLines((prev) => [
      ...prev,
      {
        key,
        productId: item.variantId ? null : item.productId,
        variantId: item.variantId,
        name: item.productName,
        variantName: item.variantName,
        sku: item.sku,
        quantity: "1",
      },
    ]);
  };

  if (transferQuery.isLoading || !transfer) {
    return <LoadingState rows={6} label="Loading transfer" />;
  }

  const busy = statusMutation.isPending || saveMutation.isPending;

  return (
    <>
      <PageHeader
        title={transfer.reference_number}
        description={`${transfer.from_location?.name ?? "—"} → ${transfer.to_location?.name ?? "—"}`}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/inventory/transfers">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              All transfers
            </Link>
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={TRANSFER_STATUS_TONE[transfer.status]}>
          {TRANSFER_STATUS_LABELS[transfer.status]}
        </StatusBadge>
        {transfer.dispatched_at && (
          <span className="text-[12px] text-muted-foreground">
            Dispatched {new Date(transfer.dispatched_at).toLocaleString()}
          </span>
        )}
        {transfer.received_at && (
          <span className="text-[12px] text-muted-foreground">
            Received {new Date(transfer.received_at).toLocaleString()}
          </span>
        )}
        {transfer.cancel_reason && (
          <span className="text-[12px] text-muted-foreground">
            Cancelled — {transfer.cancel_reason}
          </span>
        )}
      </div>

      {transfer.notes && (
        <p className="mb-3 rounded border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
          {transfer.notes}
        </p>
      )}

      <div className="rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Items
        </div>
        {isDraft && perms.canManage ? (
          <div className="space-y-3 p-3">
            <ProcurementItemPicker onAdd={addItem} disabledKeys={new Set(lines.map((l) => l.key))} />
            {lines.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No items added yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded border border-border">
                {lines.map((l) => (
                  <li key={l.key} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">
                        {l.name}
                        {l.variantName && (
                          <span className="text-muted-foreground"> — {l.variantName}</span>
                        )}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">{l.sku ?? "No SKU"}</p>
                    </div>
                    <Input
                      inputMode="numeric"
                      value={l.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.key === l.key
                              ? { ...x, quantity: e.target.value.replace(/[^0-9]/g, "") }
                              : x,
                          ),
                        )
                      }
                      className="h-8 w-20 text-[13px] tabular-nums"
                      aria-label={`Quantity for ${l.name}`}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      aria-label={`Remove ${l.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={busy}>
                {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save items
              </Button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">No items on this transfer.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Requested</th>
                <th className="px-3 py-2 text-right font-semibold">Shipped</th>
                <th className="px-3 py-2 text-right font-semibold">Received</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">
                    <div className="font-medium">
                      {i.product_name_snapshot}
                      {i.variant_name_snapshot ? ` — ${i.variant_name_snapshot}` : ""}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {i.sku_snapshot ?? "No SKU"}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{i.requested_quantity}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{i.shipped_quantity}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{i.received_quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
          {error}
        </p>
      )}

      {perms.canManage && transfer.status !== "received" && transfer.status !== "cancelled" && (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-card p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Actions
          </p>
          <div className="flex flex-wrap gap-2">
            {transfer.status === "draft" && (
              <Button
                size="sm"
                disabled={busy || items.length === 0}
                onClick={() => statusMutation.mutate({ status: "pending" })}
              >
                Submit for dispatch
              </Button>
            )}
            {transfer.status === "pending" && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => statusMutation.mutate({ status: "in_transit" })}
              >
                Dispatch stock
              </Button>
            )}
            {transfer.status === "in_transit" && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => statusMutation.mutate({ status: "received" })}
              >
                Receive at destination
              </Button>
            )}
          </div>

          <div className="space-y-1.5 border-t border-border pt-3">
            <Label className="text-[12px]">Cancel this transfer</Label>
            <Textarea
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="A reason is required"
              className="text-[13px]"
            />
            <p className="text-[11.5px] text-muted-foreground">
              {transfer.status === "in_transit"
                ? "Cancelling a dispatched transfer returns the stock to the source location. Administrators only."
                : "No stock has moved yet, so nothing is reversed."}
            </p>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !cancelReason.trim()}
              onClick={() =>
                statusMutation.mutate({ status: "cancelled", reason: cancelReason.trim() })
              }
            >
              Cancel transfer
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
