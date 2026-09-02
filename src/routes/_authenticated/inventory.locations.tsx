import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { LocationFormPanel } from "@/components/inventory/LocationFormPanel";
import type { LocationFormState } from "@/components/inventory/LocationFormPanel";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  archiveLocation,
  getLocations,
  locationLevelCounts,
  restoreLocation,
  setDefaultLocation,
} from "@/lib/inventory";
import { ENTITY_STATUS_LABELS } from "@/types/commerce";
import type { EntityStatus } from "@/types/commerce";
import type { InventoryLocation } from "@/types/inventory";
import type { StatusTone } from "@/components/shared/StatusBadge";

const TITLE = "Inventory Locations · Commerce Operations";
const DESCRIPTION = "Warehouses, shops and hubs that physically hold your stock.";

export const Route = createFileRoute("/_authenticated/inventory/locations")({
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

const STATUS_TONE: Record<EntityStatus, StatusTone> = {
  active: "success",
  inactive: "warning",
  archived: "danger",
};

function Page() {
  const qc = useQueryClient();
  const perms = useCommercePermissions();
  const [formState, setFormState] = useState<LocationFormState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<InventoryLocation | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => getLocations(),
  });

  const countsQuery = useQuery({
    queryKey: ["inventory-location-counts"],
    queryFn: () => locationLevelCounts(),
  });

  const rows = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const counts = countsQuery.data ?? {};

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-locations"] });
    void qc.invalidateQueries({ queryKey: ["inventory"] });
  };

  const defaultMutation = useMutation({
    mutationFn: (id: string) => setDefaultLocation(id),
    onSuccess: () => {
      invalidate();
      toast.success("Default location updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update."),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveLocation(id),
    onSuccess: () => {
      invalidate();
      setArchiveTarget(null);
      toast.success("Location archived");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not archive."),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreLocation(id),
    onSuccess: () => {
      invalidate();
      toast.success("Location restored");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not restore."),
  });

  return (
    <>
      <PageHeader
        title="Inventory Locations"
        description={DESCRIPTION}
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/inventory">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Inventory
              </Link>
            </Button>
            {perms.canManage && (
              <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Location
              </Button>
            )}
          </>
        }
      />

      <div className="rounded-md border border-border bg-card">
        {locationsQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {locationsQuery.error instanceof Error
              ? locationsQuery.error.message
              : "Failed to load locations."}
          </p>
        ) : locationsQuery.isLoading ? (
          <LoadingState rows={4} label="Loading locations" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No locations yet"
            description="Add the warehouse or shop where your stock is held to start tracking inventory."
            action={
              perms.canManage ? (
                <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Location
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Location</th>
                  <th className="px-3 py-2 text-left font-semibold">Code</th>
                  <th className="px-3 py-2 text-right font-semibold">Stock records</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-center font-semibold">Default</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((loc) => (
                  <tr key={loc.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{loc.name}</div>
                      {loc.description && (
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {loc.description}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-muted-foreground">
                      {loc.code}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {counts[loc.id] ?? 0}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={STATUS_TONE[loc.status]}>
                        {ENTITY_STATUS_LABELS[loc.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-1.5 text-center text-muted-foreground">
                      {loc.is_default ? "★" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {(perms.canManage || perms.canArchive) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            {perms.canManage && (
                              <DropdownMenuItem
                                onSelect={() => setFormState({ mode: "edit", location: loc })}
                              >
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            {perms.canManage && loc.status === "active" && !loc.is_default && (
                              <DropdownMenuItem onSelect={() => defaultMutation.mutate(loc.id)}>
                                <Star className="mr-2 h-3.5 w-3.5" />
                                Make default
                              </DropdownMenuItem>
                            )}
                            {perms.canArchive &&
                              (loc.status === "archived" ? (
                                <DropdownMenuItem onSelect={() => restoreMutation.mutate(loc.id)}>
                                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                  Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => setArchiveTarget(loc)}>
                                  <Archive className="mr-2 h-3.5 w-3.5" />
                                  Archive
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LocationFormPanel state={formState} onClose={() => setFormState(null)} />

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name ?? "location"}?`}
        description={
          archiveTarget && (counts[archiveTarget.id] ?? 0) > 0
            ? `This location holds ${counts[archiveTarget.id]} stock records. History stays intact, but no new stock can be added or moved there.`
            : "Archived locations cannot receive new stock records or movements."
        }
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          if (archiveTarget) archiveMutation.mutate(archiveTarget.id);
        }}
      />
    </>
  );
}
