import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getActiveLocations } from "@/lib/inventory";
import { createTransfer, getTransfers } from "@/lib/inventory-ops";
import { TRANSFER_STATUS_LABELS, TRANSFER_STATUS_TONE } from "@/types/inventory";
import type { InventoryTransferStatus } from "@/types/inventory";

const TITLE = "Stock Transfers · Commerce Operations";
const DESCRIPTION = "Move stock between warehouses with full in-transit visibility.";

export const Route = createFileRoute("/_authenticated/inventory/transfers")({
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
  const perms = useCommercePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState<InventoryTransferStatus | "all">("all");
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["inventory-locations", "active"],
    queryFn: () => getActiveLocations(),
  });

  const transfersQuery = useQuery({
    queryKey: ["inventory-transfers", status],
    queryFn: () => getTransfers(status),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!fromId || !toId) throw new Error("Choose both a source and a destination location.");
      if (fromId === toId) throw new Error("Source and destination must be different.");
      return createTransfer({ fromLocationId: fromId, toLocationId: toId, notes });
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["inventory-transfers"] });
      setOpen(false);
      setFromId("");
      setToId("");
      setNotes("");
      setError(null);
      toast.success("Transfer created");
      void navigate({ to: "/inventory/transfers/$id", params: { id } });
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not create the transfer."),
  });

  const rows = transfersQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Stock Transfers"
        description={DESCRIPTION}
        actions={
          perms.canManage ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New transfer
            </Button>
          ) : null
        }
      />

      <div className="mb-3">
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="h-8 w-[190px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All transfers</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending">Pending dispatch</SelectItem>
            <SelectItem value="in_transit">In transit</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {transfersQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {transfersQuery.error instanceof Error
              ? transfersQuery.error.message
              : "Failed to load transfers."}
          </p>
        ) : transfersQuery.isLoading ? (
          <LoadingState rows={5} label="Loading transfers" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transfers yet"
            description="Create a transfer to move stock from one location to another."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Reference</th>
                  <th className="px-3 py-2 text-left font-semibold">From</th>
                  <th className="px-3 py-2 text-left font-semibold">To</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Created</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5 font-medium">{t.reference_number}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {t.from_location?.name ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {t.to_location?.name ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={TRANSFER_STATUS_TONE[t.status]}>
                        {TRANSFER_STATUS_LABELS[t.status]}
                      </StatusBadge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/inventory/transfers/$id" params={{ id: t.id }}>
                          Open
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">New stock transfer</DialogTitle>
            <DialogDescription className="text-[13px]">
              Pick where the stock leaves from and where it arrives. Items are added next.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">From location</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue placeholder="Choose a source" />
                </SelectTrigger>
                <SelectContent>
                  {(locationsQuery.data ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">To location</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue placeholder="Choose a destination" />
                </SelectTrigger>
                <SelectContent>
                  {(locationsQuery.data ?? [])
                    .filter((l) => l.id !== fromId)
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Notes</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-[13px]"
                placeholder="Optional"
              />
            </div>

            {error && (
              <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Create transfer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
