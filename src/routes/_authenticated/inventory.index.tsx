import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { StockAdjustDialog } from "@/components/inventory/StockAdjustDialog";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getInventoryItems, getLocations } from "@/lib/inventory";
import { STOCK_STATE_LABELS, stockState } from "@/types/inventory";
import type { InventoryItem, StockState } from "@/types/inventory";
import { SUPPLY_MODEL_LABELS } from "@/types/commerce";

const TITLE = "Inventory · Commerce Operations";
const DESCRIPTION = "Track stock on hand, reserved and available across every location.";

export const Route = createFileRoute("/_authenticated/inventory/")({
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

const STATE_TONE = {
  out_of_stock: "danger",
  low_stock: "warning",
  in_stock: "success",
} as const;

function Page() {
  const perms = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<StockState | "all" | "attention">("all");
  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => getLocations(),
  });

  const itemsQuery = useQuery({
    queryKey: ["inventory", "list"],
    queryFn: () => getInventoryItems(),
  });

  const all = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((item) => {
      if (locationFilter !== "all" && item.locationId !== locationFilter) return false;
      const state = stockState(item);
      if (stateFilter === "attention" && state === "in_stock") return false;
      if (stateFilter !== "all" && stateFilter !== "attention" && state !== stateFilter) return false;
      if (!term) return true;
      return (
        item.itemName.toLowerCase().includes(term) ||
        (item.variantTitle ?? "").toLowerCase().includes(term) ||
        (item.sku ?? "").toLowerCase().includes(term)
      );
    });
  }, [all, search, locationFilter, stateFilter]);

  const attention = all.filter((i) => stockState(i) !== "in_stock").length;

  return (
    <>
      <PageHeader
        title="Inventory"
        description={DESCRIPTION}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/inventory/locations">
              <MapPin className="mr-1.5 h-3.5 w-3.5" />
              Locations
            </Link>
          </Button>
        }
      />

      {attention > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {attention} stock {attention === 1 ? "record needs" : "records need"} attention (low or out
          of stock).
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => setStateFilter("attention")}
          >
            Show them
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, variant or SKU"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="h-8 w-[180px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {(locationsQuery.data ?? []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as typeof stateFilter)}>
          <SelectTrigger className="h-8 w-[150px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stock</SelectItem>
            <SelectItem value="attention">Needs attention</SelectItem>
            <SelectItem value="low_stock">Low stock</SelectItem>
            <SelectItem value="out_of_stock">Out of stock</SelectItem>
            <SelectItem value="in_stock">In stock</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {itemsQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {itemsQuery.error instanceof Error
              ? itemsQuery.error.message
              : "Failed to load inventory."}
          </p>
        ) : itemsQuery.isLoading ? (
          <LoadingState rows={6} label="Loading inventory" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={all.length === 0 ? "No stock records yet" : "No matching stock records"}
            description={
              all.length === 0
                ? "Create a location, then add stock records from a product's Inventory section."
                : "Try a different search term or adjust the filters."
            }
            action={
              all.length === 0 ? (
                <Button size="sm" asChild>
                  <Link to="/inventory/locations">Manage locations</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Item</th>
                  <th className="px-3 py-2 text-left font-semibold">Location</th>
                  <th className="px-3 py-2 text-left font-semibold">Supply</th>
                  <th className="px-3 py-2 text-right font-semibold">On hand</th>
                  <th className="px-3 py-2 text-right font-semibold">Reserved</th>
                  <th className="px-3 py-2 text-right font-semibold">Available</th>
                  <th className="px-3 py-2 text-right font-semibold">Incoming</th>
                  <th className="px-3 py-2 text-left font-semibold">State</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const state = stockState(item);
                  return (
                    <tr
                      key={item.levelId}
                      className="border-b border-border last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{item.itemName}</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {item.variantTitle ? `${item.variantTitle} · ` : ""}
                          {item.sku ?? "No SKU"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {item.locationName}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {SUPPLY_MODEL_LABELS[item.supplyModel]}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.onHand}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{item.reserved}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                        {item.available}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {item.incoming}
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge tone={STATE_TONE[state]}>
                          {STOCK_STATE_LABELS[state]}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelected(item)}>
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
      </div>

      <StockAdjustDialog
        item={selected}
        onClose={() => setSelected(null)}
        canManage={perms.canManage}
      />
    </>
  );
}
