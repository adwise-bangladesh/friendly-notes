import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Scale } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { getSettlementDiscrepancies, resolveSettlementDiscrepancy } from "@/lib/finance";
import {
  DISCREPANCY_RESOLUTIONS,
  DISCREPANCY_RESOLUTION_EFFECT,
  DISCREPANCY_RESOLUTION_LABELS,
  DISCREPANCY_STATUS_LABELS,
  DISCREPANCY_STATUS_TONE,
  discrepancyDirectionLabel,
  postsAdjustment,
} from "@/types/finance";
import type {
  DiscrepancyResolution,
  DiscrepancyStatus,
  DiscrepancyWithContext,
} from "@/types/finance";

/**
 * Settlement discrepancies: what we expected the courier to settle versus what
 * they actually settled. Rows come straight from the database; resolving one
 * goes through resolve_settlement_discrepancy().
 */
export function SettlementDiscrepancies({
  settlementId,
  canManage,
  statusFilter = true,
}: {
  settlementId?: string;
  canManage: boolean;
  statusFilter?: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<DiscrepancyStatus | "all">("all");
  const [active, setActive] = useState<DiscrepancyWithContext | null>(null);

  const filters = { status, ...(settlementId ? { settlementId } : {}) };
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["settlement-discrepancies", settlementId ?? "all", status],
    queryFn: () => getSettlementDiscrepancies(filters),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["settlement-discrepancies"] });
    void queryClient.invalidateQueries({ queryKey: ["order-financials"] });
    void queryClient.invalidateQueries({ queryKey: ["courier-settlement"] });
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-3">
      {statusFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All discrepancies</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[12px] text-muted-foreground">
            Open discrepancies weigh on order profit until they are resolved.
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No settlement discrepancies"
          description="A discrepancy appears when a courier settles a different amount than the shipment collected."
        />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Courier / settlement</th>
                <th className="px-2 py-1.5 text-left font-medium">Order · shipment</th>
                <th className="px-2 py-1.5 text-right font-medium">Expected</th>
                <th className="px-2 py-1.5 text-right font-medium">Settled</th>
                <th className="px-2 py-1.5 text-right font-medium">Difference</th>
                <th className="px-2 py-1.5 text-left font-medium">Type</th>
                <th className="px-2 py-1.5 text-left font-medium">Status</th>
                <th className="px-2 py-1.5 text-left font-medium">Created</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-2 py-1.5">
                    <div>{d.account_name ?? "Courier account"}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {d.provider_name ? `${d.provider_name} · ` : ""}
                      {d.settlement ? (
                        <Link
                          to="/finance/courier-settlements/$id"
                          params={{ id: d.settlement.id }}
                          className="text-primary hover:underline"
                        >
                          {d.settlement.settlement_reference}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {d.order ? (
                      <Link
                        to="/orders/$id"
                        params={{ id: d.order.id }}
                        className="text-primary hover:underline"
                      >
                        {d.order.order_number}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <div className="text-[11.5px] text-muted-foreground">
                      {d.shipment?.shipment_number ?? "—"}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMoney(Number(d.expected_amount))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatMoney(Number(d.settled_amount))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                    {formatMoney(Number(d.difference))}
                  </td>
                  <td className="px-2 py-1.5">{discrepancyDirectionLabel(d.direction)}</td>
                  <td className="px-2 py-1.5">
                    <StatusBadge tone={DISCREPANCY_STATUS_TONE[d.status]}>
                      {DISCREPANCY_STATUS_LABELS[d.status]}
                    </StatusBadge>
                    {d.status === "resolved" && d.resolution && (
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {DISCREPANCY_RESOLUTION_LABELS[d.resolution]}
                        {d.resolution_note ? ` · ${d.resolution_note}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {new Date(d.created_at).toLocaleDateString()}
                    {d.resolved_at && (
                      <div className="text-[11.5px]">
                        resolved {new Date(d.resolved_at).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {canManage && d.status === "open" && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setActive(d)}>
                        Review
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ResolveDialog
        discrepancy={active}
        onClose={() => setActive(null)}
        onResolved={() => {
          setActive(null);
          invalidate();
        }}
      />
    </div>
  );
}

function ResolveDialog({
  discrepancy,
  onClose,
  onResolved,
}: {
  discrepancy: DiscrepancyWithContext | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [resolution, setResolution] = useState<DiscrepancyResolution>("written_off");
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: () =>
      resolveSettlementDiscrepancy({
        discrepancyId: discrepancy!.id,
        resolution,
        note: note.trim() ? note.trim() : undefined,
      }),
    onSuccess: () => {
      toast.success("Discrepancy resolved.");
      setNote("");
      onResolved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!discrepancy) return null;
  const difference = Number(discrepancy.difference);
  const posts = postsAdjustment(resolution);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve settlement discrepancy</DialogTitle>
          <DialogDescription>
            Resolution is permanent and the discrepancy stays in history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[13px]">
          <div className="grid grid-cols-3 gap-2 rounded border border-border p-2.5 text-center">
            <Figure label="Expected" value={formatMoney(Number(discrepancy.expected_amount))} />
            <Figure label="Actual settled" value={formatMoney(Number(discrepancy.settled_amount))} />
            <Figure label="Difference" value={formatMoney(difference)} strong />
          </div>
          <p className="text-[12px] text-muted-foreground">
            {discrepancyDirectionLabel(discrepancy.direction)} on{" "}
            {discrepancy.settlement?.settlement_reference ?? "settlement"} ·{" "}
            {discrepancy.order?.order_number ?? "order"} ·{" "}
            {discrepancy.shipment?.shipment_number ?? "shipment"} ·{" "}
            {discrepancy.account_name ?? "courier account"}
          </p>

          <div className="space-y-1.5">
            <Label>Resolution</Label>
            <Select value={resolution} onValueChange={(v) => setResolution(v as DiscrepancyResolution)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCREPANCY_RESOLUTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {DISCREPANCY_RESOLUTION_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground">
              {DISCREPANCY_RESOLUTION_EFFECT[resolution]}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="resolution-note">Note {posts ? "(recommended)" : "(optional)"}</Label>
            <Textarea
              id="resolution-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was agreed with the courier."
            />
          </div>

          <div className="rounded border border-border bg-muted/40 p-2.5 text-[12.5px]">
            <p className="font-medium">Financial consequence</p>
            <p className="text-muted-foreground">
              {posts
                ? `A ${difference < 0 ? "expense" : "income"} adjustment of ${formatMoney(
                    Math.abs(difference),
                  )} will be posted on the order.`
                : "No adjustment is posted. The order stops carrying this as an open discrepancy."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
            {resolve.isPending ? "Resolving…" : "Resolve discrepancy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</p>
    </div>
  );
}
