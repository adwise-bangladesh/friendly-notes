import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
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
import { getLocations } from "@/lib/inventory";
import { getMovementLedger } from "@/lib/inventory-ops";
import {
  ADJUSTMENT_REASON_LABELS,
  MOVEMENT_TYPE_LABELS,
  movementDirection,
} from "@/types/inventory";
import type { InventoryMovementType } from "@/types/inventory";

const TITLE = "Stock Movements · Commerce Operations";
const DESCRIPTION =
  "A complete, unchangeable audit trail of every stock movement across all locations.";

export const Route = createFileRoute("/_authenticated/inventory/movements")({
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

const ALL_TYPES = Object.keys(MOVEMENT_TYPE_LABELS) as InventoryMovementType[];

function Page() {
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [type, setType] = useState("all");
  const [days, setDays] = useState("30");

  const locationsQuery = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: () => getLocations(),
  });

  const from = useMemo(() => {
    if (days === "all") return undefined;
    const d = new Date();
    d.setDate(d.getDate() - Number(days));
    return d.toISOString();
  }, [days]);

  const ledgerQuery = useQuery({
    queryKey: ["inventory-ledger", locationId, type, days, search],
    queryFn: () =>
      getMovementLedger({
        ...(locationId !== "all" ? { locationId } : {}),
        ...(type !== "all" ? { movementType: type } : {}),
        ...(from ? { from } : {}),
        ...(search.trim() ? { search } : {}),
      }),
  });

  const rows = ledgerQuery.data ?? [];

  return (
    <>
      <PageHeader title="Stock Movements" description={DESCRIPTION} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, SKU or note"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <Select value={locationId} onValueChange={setLocationId}>
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
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-8 w-[200px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All movement types</SelectItem>
            {ALL_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {MOVEMENT_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="h-8 w-[140px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {ledgerQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {ledgerQuery.error instanceof Error
              ? ledgerQuery.error.message
              : "Failed to load movements."}
          </p>
        ) : ledgerQuery.isLoading ? (
          <LoadingState rows={8} label="Loading movements" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="No movements found"
            description="Nothing was recorded for these filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">When</th>
                  <th className="px-3 py-2 text-left font-semibold">Item</th>
                  <th className="px-3 py-2 text-left font-semibold">Location</th>
                  <th className="px-3 py-2 text-left font-semibold">Movement</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">On hand</th>
                  <th className="px-3 py-2 text-left font-semibold">Reason / note</th>
                  <th className="px-3 py-2 text-left font-semibold">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const dir = movementDirection(m.movement_type);
                  return (
                    <tr key={m.id} className="border-b border-border last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{m.itemName}</div>
                        <div className="text-[11.5px] text-muted-foreground">
                          {m.variantTitle ? `${m.variantTitle} · ` : ""}
                          {m.sku ?? "No SKU"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {m.locationName}
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge
                          tone={dir === "in" ? "success" : dir === "out" ? "danger" : "info"}
                        >
                          {MOVEMENT_TYPE_LABELS[m.movement_type]}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                        {dir === "in" ? "+" : dir === "out" ? "−" : "±"}
                        {m.quantity}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {m.on_hand_before === null || m.on_hand_after === null
                          ? "—"
                          : `${m.on_hand_before} → ${m.on_hand_after}`}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {m.reason ? (
                          <span className="font-medium text-foreground">
                            {ADJUSTMENT_REASON_LABELS[m.reason]}
                          </span>
                        ) : null}
                        {m.reason && m.note ? " · " : ""}
                        {m.note ?? (m.reason ? "" : "—")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {m.actorName ?? "System"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
