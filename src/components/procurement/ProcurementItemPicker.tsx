import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/currency";
import { searchStockableItems } from "@/lib/procurement";
import type { StockableItemOption } from "@/lib/procurement";

/**
 * Item search for procurement. Only stock-carrying items appear: simple
 * products and variants of variable products. Bundles, services and digital
 * products are never purchasable stock.
 */
export function ProcurementItemPicker({
  onAdd,
  disabledKeys,
}: {
  onAdd: (item: StockableItemOption) => void;
  disabledKeys: Set<string>;
}) {
  const [term, setTerm] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["procurement-item-search", term],
    queryFn: () => searchStockableItems(term),
  });

  return (
    <div className="rounded border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search stock items by name or SKU"
          className="h-8 border-0 px-0 text-[13px] shadow-none focus-visible:ring-0"
          aria-label="Search stock items"
        />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {isLoading && <p className="px-3 py-3 text-[12.5px] text-muted-foreground">Searching…</p>}
        {!isLoading && items.length === 0 && (
          <p className="px-3 py-3 text-[12.5px] text-muted-foreground">
            No stock-carrying item matched.
          </p>
        )}
        {items.map((item) => {
          const key = item.variantId ?? item.productId;
          const already = disabledKeys.has(key);
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px]">
                  {item.productName}
                  {item.variantName && (
                    <span className="text-muted-foreground"> — {item.variantName}</span>
                  )}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {item.sku ?? "No SKU"}
                  {item.baseCost !== null && ` · last cost ${formatMoney(item.baseCost)}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={already}
                onClick={() => onAdd(item)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {already ? "Added" : "Add"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
