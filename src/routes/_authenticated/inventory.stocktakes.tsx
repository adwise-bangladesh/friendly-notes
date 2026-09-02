import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, Plus } from "lucide-react";
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
import { createStocktake, getStocktakes } from "@/lib/inventory-ops";
import { STOCKTAKE_STATUS_LABELS, STOCKTAKE_STATUS_TONE } from "@/types/inventory";

const TITLE = "Stocktakes · Commerce Operations";
const DESCRIPTION = "Count physical stock and reconcile differences safely.";

export const Route = createFileRoute("/_authenticated/inventory/stocktakes")({
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
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["inventory-locations", "active"],
    queryFn: () => getActiveLocations(),
  });
  const stocktakesQuery = useQuery({
    queryKey: ["stocktakes"],
    queryFn: () => getStocktakes(),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("Choose a location to count.");
      return createStocktake(locationId, notes);
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: ["stocktakes"] });
      setOpen(false);
      setLocationId("");
      setNotes("");
      setError(null);
      toast.success("Stocktake created");
      void navigate({ to: "/inventory/stocktakes/$id", params: { id } });
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not create the stocktake."),
  });

  const rows = stocktakesQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Stocktakes"
        description={DESCRIPTION}
        actions={
          perms.canManage ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New stocktake
            </Button>
          ) : null
        }
      />

      <div className="rounded-md border border-border bg-card">
        {stocktakesQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {stocktakesQuery.error instanceof Error
              ? stocktakesQuery.error.message
              : "Failed to load stocktakes."}
          </p>
        ) : stocktakesQuery.isLoading ? (
          <LoadingState rows={5} label="Loading stocktakes" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No stocktakes yet"
            description="Start a stocktake to compare physical stock against the system."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Reference</th>
                  <th className="px-3 py-2 text-left font-semibold">Location</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Created</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5 font-medium">{s.reference_number}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{s.location?.name ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={STOCKTAKE_STATUS_TONE[s.status]}>
                        {STOCKTAKE_STATUS_LABELS[s.status]}
                      </StatusBadge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/inventory/stocktakes/$id" params={{ id: s.id }}>
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
            <DialogTitle className="text-base">New stocktake</DialogTitle>
            <DialogDescription className="text-[13px]">
              A snapshot of current system quantities is taken when you start counting.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue placeholder="Choose a location" />
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
                Create stocktake
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
