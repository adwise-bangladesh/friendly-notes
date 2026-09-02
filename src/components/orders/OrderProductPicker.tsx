import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import { searchOrderProducts } from "@/lib/orders";
import type { OrderProductOption } from "@/lib/orders";
import type { DraftOrderItem } from "@/types/orders";

interface Props {
  onAdd: (item: Omit<DraftOrderItem, "key">) => void;
}

/**
 * Compact product search for the order builder.
 * A variable parent can never be added directly — only one of its variants.
 */
export function OrderProductPicker({ onAdd }: Props) {
  const [term, setTerm] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["order-product-search", term],
    queryFn: () => searchOrderProducts(term),
  });

  function addSimple(p: OrderProductOption) {
    onAdd({
      productId: p.id,
      variantId: null,
      productName: p.name,
      variantName: null,
      sku: p.sku,
      productType: p.product_type,
      unitPrice: Number(p.price),
      compareAtPrice: p.compare_at_price === null ? null : Number(p.compare_at_price),
      quantity: 1,
      discountAmount: 0,
    });
  }

  function addVariant(p: OrderProductOption, v: OrderProductOption["product_variants"][number]) {
    if (v.price === null) return;
    onAdd({
      productId: p.id,
      variantId: v.id,
      productName: p.name,
      variantName: v.title,
      sku: v.sku ?? p.sku,
      productType: p.product_type,
      unitPrice: Number(v.price),
      compareAtPrice: v.compare_at_price === null ? null : Number(v.compare_at_price),
      quantity: 1,
      discountAmount: 0,
    });
  }

  return (
    <div className="rounded border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search product name, SKU or barcode"
          className="h-8 border-0 px-0 text-[13px] shadow-none focus-visible:ring-0"
          aria-label="Search products"
        />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {isLoading && <p className="px-3 py-3 text-[12.5px] text-muted-foreground">Searching…</p>}
        {!isLoading && products.length === 0 && (
          <p className="px-3 py-3 text-[12.5px] text-muted-foreground">
            No purchasable product matched.
          </p>
        )}
        {products.map((p) => {
          const isVariable = p.product_type === "variable";
          const open = expanded === p.id;
          const variants = p.product_variants.filter((v) => v.status === "active");
          return (
            <div key={p.id} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">{p.name}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {p.sku ?? "No SKU"} · {p.product_type}
                    {!isVariable && ` · ${formatMoney(Number(p.price))}`}
                  </p>
                </div>
                {isVariable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setExpanded(open ? null : p.id)}
                  >
                    {open ? "Hide variants" : `Choose variant (${variants.length})`}
                  </Button>
                ) : (
                  <Button type="button" size="sm" className="h-7" onClick={() => addSimple(p)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add
                  </Button>
                )}
              </div>
              {isVariable && open && (
                <div className="bg-muted/40 px-3 pb-2">
                  {variants.length === 0 && (
                    <p className="py-2 text-[12px] text-muted-foreground">
                      This product has no active variant to order.
                    </p>
                  )}
                  {variants.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] text-foreground">{v.title}</p>
                        <p className="text-[11.5px] text-muted-foreground">
                          {v.sku ?? "No SKU"} ·{" "}
                          {v.price === null ? "Unpriced" : formatMoney(Number(v.price))}
                        </p>
                      </div>
                      {v.price === null ? (
                        <StatusBadge tone="warning">Not purchasable</StatusBadge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => addVariant(p, v)}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" /> Add
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
