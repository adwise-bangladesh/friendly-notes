import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  cancelStocktake,
  finalizeStocktake,
  getStocktake,
  getStocktakeItems,
  setStocktakeCounts,
  startStocktake,
} from "@/lib/inventory-ops";
import { STOCKTAKE_STATUS_LABELS, STOCKTAKE_STATUS_TONE } from "@/types/inventory";

const TITLE = "Stocktake · Commerce Operations";
const DESCRIPTION = "Enter physical counts and reconcile the difference against the system.";

export const Route = createFileRoute("/_authenticated/inventory/stocktakes_/$id")({
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
      This stocktake could not be loaded.
    </p>
  ),
  notFoundComponent: () => (
    <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Stocktake not found.</p>
  ),
});

function Page() {
  const { id } = Route.useParams();
  const perms = useCommercePermissions();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stocktakeQuery = useQuery({
    queryKey: ["stocktake", id],
    queryFn: () => getStocktake(id),
  });
  const itemsQuery = useQuery({
    queryKey: ["stocktake-items", id],
    queryFn: () => getStocktakeItems(id),
  });

  const stocktake = stocktakeQuery.data;
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const inProgress = stocktake?.status === "in_progress";

  useEffect(() => {
    setCounts(
      Object.fromEntries(
        items.map((i) => [i.id, i.counted_quantity === null ? "" : String(i.counted_quantity)]),
      ),
    );
  }, [items]);

  const staleCount = items.filter(
    (i) => i.counted_quantity !== null && i.liveQuantity !== i.system_quantity,
  ).length;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["stocktake", id] });
    void qc.invalidateQueries({ queryKey: ["stocktake-items", id] });
    void qc.invalidateQueries({ queryKey: ["stocktakes"] });
    void qc.invalidateQueries({ queryKey: ["inventory"] });
    void qc.invalidateQueries({ queryKey: ["inventory-ledger"] });
  };

  const handle = (fn: () => Promise<void>, message: string) =>
    fn()
      .then(() => {
        refresh();
        setError(null);
        toast.success(message);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Something went wrong."),
      );

  const startMutation = useMutation({
    mutationFn: () => handle(() => startStocktake(id), "Counting started"),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      handle(
        () =>
          setStocktakeCounts(
            id,
            items.map((i) => {
              const raw = counts[i.id] ?? "";
              const parsed = raw.trim() === "" ? null : Number.parseInt(raw, 10);
              if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
                throw new Error("Counts must be zero or greater.");
              }
              return { itemId: i.id, countedQuantity: parsed };
            }),
          ),
        "Counts saved",
      ),
  });

  const finalizeMutation = useMutation({
    mutationFn: (accept: boolean) =>
      handle(() => finalizeStocktake(id, accept), "Stocktake completed"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => handle(() => cancelStocktake(id, cancelReason.trim()), "Stocktake cancelled"),
  });

  if (stocktakeQuery.isLoading || !stocktake) {
    return <LoadingState rows={6} label="Loading stocktake" />;
  }

  const busy =
    startMutation.isPending ||
    saveMutation.isPending ||
    finalizeMutation.isPending ||
    cancelMutation.isPending;

  return (
    <>
      <PageHeader
        title={stocktake.reference_number}
        description={stocktake.location?.name ?? "Unknown location"}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/inventory/stocktakes">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              All stocktakes
            </Link>
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={STOCKTAKE_STATUS_TONE[stocktake.status]}>
          {STOCKTAKE_STATUS_LABELS[stocktake.status]}
        </StatusBadge>
        {stocktake.started_at && (
          <span className="text-[12px] text-muted-foreground">
            Started {new Date(stocktake.started_at).toLocaleString()}
          </span>
        )}
        {stocktake.completed_at && (
          <span className="text-[12px] text-muted-foreground">
            Completed {new Date(stocktake.completed_at).toLocaleString()}
          </span>
        )}
        {stocktake.cancel_reason && (
          <span className="text-[12px] text-muted-foreground">
            Cancelled — {stocktake.cancel_reason}
          </span>
        )}
      </div>

      {stocktake.status === "draft" && (
        <div className="mb-3 rounded-md border border-border bg-card p-3">
          <p className="mb-2 text-[12.5px] text-muted-foreground">
            Starting the count takes a snapshot of every stock record at this location. Stock keeps
            moving normally while you count.
          </p>
          {perms.canManage && (
            <Button size="sm" disabled={busy} onClick={() => startMutation.mutate()}>
              {startMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Start counting
            </Button>
          )}
        </div>
      )}

      {inProgress && staleCount > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Stock moved for {staleCount} counted {staleCount === 1 ? "item" : "items"} since the
            snapshot was taken. Review the live quantities, then confirm reconciliation when you
            finalise.
          </span>
        </div>
      )}

      <div className="rounded-md border border-border bg-card">
        {itemsQuery.isLoading ? (
          <LoadingState rows={5} label="Loading items" />
        ) : items.length === 0 ? (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
            No stock records were captured for this location yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Item</th>
                  <th className="px-3 py-2 text-right font-semibold">Snapshot</th>
                  <th className="px-3 py-2 text-right font-semibold">Live</th>
                  <th className="px-3 py-2 text-right font-semibold">Counted</th>
                  <th className="px-3 py-2 text-right font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const raw = counts[i.id] ?? "";
                  const parsed = raw.trim() === "" ? null : Number.parseInt(raw, 10);
                  const diff =
                    i.applied_delta ?? (parsed === null ? null : parsed - i.liveQuantity);
                  return (
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
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {i.system_quantity}
                      </td>
                      <td
                        className={
                          i.liveQuantity !== i.system_quantity
                            ? "px-3 py-1.5 text-right font-medium tabular-nums text-warning-foreground"
                            : "px-3 py-1.5 text-right tabular-nums text-muted-foreground"
                        }
                      >
                        {i.liveQuantity}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {inProgress && perms.canManage ? (
                          <Input
                            inputMode="numeric"
                            value={raw}
                            onChange={(e) =>
                              setCounts((prev) => ({
                                ...prev,
                                [i.id]: e.target.value.replace(/[^0-9]/g, ""),
                              }))
                            }
                            placeholder="—"
                            className="ml-auto h-8 w-24 text-right text-[13px] tabular-nums"
                            aria-label={`Counted quantity for ${i.product_name_snapshot}`}
                          />
                        ) : (
                          <span className="tabular-nums">{i.counted_quantity ?? "—"}</span>
                        )}
                      </td>
                      <td
                        className={
                          diff === null || diff === 0
                            ? "px-3 py-1.5 text-right tabular-nums text-muted-foreground"
                            : diff > 0
                              ? "px-3 py-1.5 text-right font-medium tabular-nums text-success"
                              : "px-3 py-1.5 text-right font-medium tabular-nums text-destructive"
                        }
                      >
                        {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
          {error}
        </p>
      )}

      {inProgress && perms.canManage && (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save counts
            </Button>
            <Button size="sm" disabled={busy} onClick={() => finalizeMutation.mutate(false)}>
              {finalizeMutation.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Finalise stocktake
            </Button>
            {staleCount > 0 && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => finalizeMutation.mutate(true)}
              >
                Finalise anyway (stock moved)
              </Button>
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Finalising corrects stock to the counted quantity through the normal movement trail. It
            cannot be undone.
          </p>

          <div className="space-y-1.5 border-t border-border pt-3">
            <Label className="text-[12px]">Cancel this stocktake</Label>
            <Textarea
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="A reason is required"
              className="text-[13px]"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !cancelReason.trim()}
              onClick={() => cancelMutation.mutate()}
            >
              Cancel stocktake
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
