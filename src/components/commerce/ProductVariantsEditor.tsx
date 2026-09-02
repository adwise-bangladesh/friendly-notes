import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCY_SYMBOL, parseMoney } from "@/lib/currency";
import type { ProductVariantDraft } from "@/types/commerce";

interface Props {
  value: ProductVariantDraft[];
  onChange: (next: ProductVariantDraft[]) => void;
  disabled?: boolean;
}

export function ProductVariantsEditor({ value, onChange, disabled }: Props) {
  const update = (key: string, patch: Partial<ProductVariantDraft>) =>
    onChange(value.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const add = () =>
    onChange([
      ...value,
      {
        key: crypto.randomUUID(),
        title: "",
        sku: null,
        barcode: null,
        price: null,
        compare_at_price: null,
        status: "active",
      },
    ]);

  const duplicateSkus = new Set(
    value
      .map((v) => v.sku?.trim().toLowerCase())
      .filter((s, i, arr): s is string => !!s && arr.indexOf(s) !== i),
  );

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="rounded border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground">
          No variants yet. Add one for each purchasable option (e.g. “Black / M”).
        </p>
      )}

      {value.map((v) => {
        const dupe = !!v.sku && duplicateSkus.has(v.sku.trim().toLowerCase());
        return (
          <div key={v.key} className="rounded border border-border bg-muted/30 p-2.5">
            <div className="grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <Input
                  value={v.title}
                  disabled={disabled}
                  placeholder="Variant title *"
                  onChange={(e) => update(v.key, { title: e.target.value })}
                  className="h-8 text-[12.5px]"
                />
              </div>
              <div className="sm:col-span-3">
                <Input
                  value={v.sku ?? ""}
                  disabled={disabled}
                  placeholder="SKU"
                  onChange={(e) => update(v.key, { sku: e.target.value || null })}
                  className="h-8 text-[12.5px]"
                  aria-invalid={dupe}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  value={v.price ?? ""}
                  disabled={disabled}
                  inputMode="decimal"
                  placeholder={`${CURRENCY_SYMBOL} price`}
                  onChange={(e) => update(v.key, { price: parseMoney(e.target.value) })}
                  className="h-8 text-[12.5px]"
                />
              </div>
              <div className="sm:col-span-2">
                <Select
                  value={v.status}
                  disabled={disabled}
                  onValueChange={(s) => update(v.key, { status: s as ProductVariantDraft["status"] })}
                >
                  <SelectTrigger className="h-8 text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-end sm:col-span-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={disabled}
                  aria-label="Remove variant"
                  onClick={() => onChange(value.filter((x) => x.key !== v.key))}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <Input
                  value={v.barcode ?? ""}
                  disabled={disabled}
                  placeholder="Barcode"
                  onChange={(e) => update(v.key, { barcode: e.target.value || null })}
                  className="h-8 text-[12.5px]"
                />
              </div>
              <div className="sm:col-span-3">
                <Input
                  value={v.compare_at_price ?? ""}
                  disabled={disabled}
                  inputMode="decimal"
                  placeholder={`${CURRENCY_SYMBOL} compare at`}
                  onChange={(e) => update(v.key, { compare_at_price: parseMoney(e.target.value) })}
                  className="h-8 text-[12.5px]"
                />
              </div>
            </div>
            {dupe && (
              <p className="mt-1.5 text-[11.5px] text-destructive">
                Duplicate SKU within this product.
              </p>
            )}
          </div>
        );
      })}

      {!disabled && (
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Variant
        </Button>
      )}
    </div>
  );
}
