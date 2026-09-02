import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StockAdjustDialog } from "./StockAdjustDialog";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { ensureInventoryLevel, getActiveLocations, getInventoryForProduct } from "@/lib/inventory";
import {
  STOCK_STATE_LABELS,
  inventoryTrackingReason,
  productTracksInventory,
  productTracksInventoryViaVariants,
  stockState,
} from "@/types/inventory";
import type { InventoryItem } from "@/types/inventory";
import { SUPPLY_MODEL_LABELS } from "@/types/commerce";
import type { ProductType, SupplyModel } from "@/types/commerce";

interface Props {
  productId: string;
  productType: ProductType;
  supplyModel: SupplyModel;
  variants: { id: string; title: string }[];
}

const STATE_TONE = {
  out_of_stock: "danger",
  low_stock: "warning",
  in_stock: "success",
} as const;

export function ProductInventorySection({
  productId,
  productType,
  supplyModel,
  variants,
}: Props) {
  const qc = useQueryClient();
  const perms = useCommercePermissions();
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [addTarget, setAddTarget] = useState<string>("");
  const [addLocation, setAddLocation] = useState<string>("");

  const tracks = productTracksInventory(productType) || productTracksInventoryViaVariants(productType);

  const levelsQuery = useQuery({
    queryKey: ["inventory", "product", productId],
    queryFn: () => getInventoryForProduct(productId),
    enabled: tracks,
  });

  const locationsQuery = useQuery({
    queryKey: ["inventory-locations", "active"],
    queryFn: () => getActiveLocations(),
    enabled: tracks,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!addLocation) throw new Error("Choose a location.");
      if (productTracksInventoryViaVariants(productType)) {
        if (!addTarget) throw new Error("Choose a variant.");
        await ensureInventoryLevel({ locationId: addLocation, variantId: addTarget });
      } else {
        await ensureInventoryLevel({ locationId: addLocation, productId });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      setAddTarget("");
      setAddLocation("");
      toast.success("Stock record created");
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not create the stock record."),
  });

  if (!tracks) {
    return (
      <p className="rounded border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
        {inventoryTrackingReason(productType)}
      </p>
    );
  }

  const rows = levelsQuery.data ?? [];
  const locations = locationsQuery.data ?? [];

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted-foreground">
        {inventoryTrackingReason(productType)} Supply model:{" "}
        <span className="font-medium text-foreground">{SUPPLY_MODEL_LABELS[supplyModel]}</span>.
        {supplyModel !== "in_stock" && " Stock levels are informational for this supply model — availability does not depend on them."}
      </p>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          No stock records yet. Add one below to start tracking.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Item / Location</th>
                <th className="px-3 py-2 text-right font-semibold">On hand</th>
                <th className="px-3 py-2 text-right font-semibold">Reserved</th>
                <th className="px-3 py-2 text-right font-semibold">Available</th>
                <th className="px-3 py-2 text-left font-semibold">State</th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = stockState(row);
                return (
                  <tr key={row.levelId} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{row.variantTitle ?? row.itemName}</div>
                      <div className="text-[11.5px] text-muted-foreground">{row.locationName}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.onHand}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.reserved}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {row.available}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={STATE_TONE[state]}>{STOCK_STATE_LABELS[state]}</StatusBadge>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                        {perms.canManage ? "Adjust" : "View"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {perms.canManage && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          {productTracksInventoryViaVariants(productType) && (
            <Select value={addTarget} onValueChange={setAddTarget}>
              <SelectTrigger className="h-8 w-[190px] text-[13px]">
                <SelectValue placeholder="Variant" />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={addLocation} onValueChange={setAddLocation}>
            <SelectTrigger className="h-8 w-[190px] text-[13px]">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add stock record
          </Button>
          {locations.length === 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              No active locations yet —{" "}
              <Link to="/inventory/locations" className="underline">
                create one first
              </Link>
              .
            </p>
          )}
        </div>
      )}

      <StockAdjustDialog
        item={selected}
        onClose={() => setSelected(null)}
        canManage={perms.canManage}
      />
    </div>
  );
}
