import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductMediaManager } from "./ProductMediaManager";
import { CURRENCY_SYMBOL, formatMoney, parseMoney } from "@/lib/currency";
import { effectiveCost, estimatedMargin } from "@/types/commerce";
import type { ProductVariantDraft } from "@/types/commerce";
import { cn } from "@/lib/utils";

interface Props {
  value: ProductVariantDraft[];
  onChange: (next: ProductVariantDraft[]) => void;
  disabled?: boolean;
  /** Parent product cost, used to show inherited values. */
  productCost: { base_cost: number; additional_cost: number };
  /** Parent physical values, used to show inherited values. */
  productPhysical: {
    weight: number | null;
    length: number | null;
    width: number | null;
    height: number | null;
    weight_unit: string;
    dimension_unit: string;
  };
}

const parseNum = (v: string): number | null => {
  const cleaned = v.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

export function ProductVariantsEditor({
  value,
  onChange,
  disabled,
  productCost,
  productPhysical,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (key: string, patch: Partial<ProductVariantDraft>) =>
    onChange(value.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const add = () => {
    const key = crypto.randomUUID();
    onChange([
      ...value,
      {
        key,
        title: "",
        sku: null,
        barcode: null,
        price: null,
        compare_at_price: null,
        status: "active",
        base_cost: null,
        additional_cost: null,
        weight: null,
        length: null,
        width: null,
        height: null,
        media: [],
      },
    ]);
    setExpanded(key);
  };

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
        const cost = effectiveCost(v, productCost);
        const margin = estimatedMargin(v.price ?? 0, cost.landed);
        const open = expanded === v.key;
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
                  disabled={disabled ?? false}
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

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : v.key)}
                className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Cost, physical & images
              </button>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px]",
                  cost.overridden
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {cost.overridden ? "Uses Variant Override" : "Uses Product Default Cost"}
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                Landed {formatMoney(cost.landed)}
                {v.price !== null && (
                  <>
                    {" · "}Est. margin {formatMoney(margin.margin)}
                    {margin.percentage !== null && ` (${margin.percentage.toFixed(1)}%)`}
                  </>
                )}
              </span>
              {v.media.length > 0 && (
                <span className="text-[11.5px] text-muted-foreground">
                  {v.media.length} image{v.media.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {open && (
              <div className="mt-2.5 space-y-3 border-t border-border pt-2.5">
                <div className="grid gap-2 sm:grid-cols-12">
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
                      onChange={(e) =>
                        update(v.key, { compare_at_price: parseMoney(e.target.value) })
                      }
                      className="h-8 text-[12.5px]"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-[12px] text-muted-foreground">
                    Cost Overrides (leave empty to inherit the product cost)
                  </Label>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-12">
                    <div className="sm:col-span-3">
                      <Input
                        value={v.base_cost ?? ""}
                        disabled={disabled}
                        inputMode="decimal"
                        placeholder={`Base ${formatMoney(productCost.base_cost)}`}
                        onChange={(e) => update(v.key, { base_cost: parseMoney(e.target.value) })}
                        className="h-8 text-[12.5px]"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Input
                        value={v.additional_cost ?? ""}
                        disabled={disabled}
                        inputMode="decimal"
                        placeholder={`Additional ${formatMoney(productCost.additional_cost)}`}
                        onChange={(e) =>
                          update(v.key, { additional_cost: parseMoney(e.target.value) })
                        }
                        className="h-8 text-[12.5px]"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-[12px] text-muted-foreground">
                    Physical Overrides (empty inherits the product value)
                  </Label>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-12">
                    <div className="sm:col-span-3">
                      <Input
                        value={v.weight ?? ""}
                        disabled={disabled}
                        inputMode="decimal"
                        placeholder={`Weight ${productPhysical.weight ?? "—"} ${productPhysical.weight_unit}`}
                        onChange={(e) => update(v.key, { weight: parseNum(e.target.value) })}
                        className="h-8 text-[12.5px]"
                      />
                    </div>
                    {(["length", "width", "height"] as const).map((dim) => (
                      <div key={dim} className="sm:col-span-3">
                        <Input
                          value={v[dim] ?? ""}
                          disabled={disabled}
                          inputMode="decimal"
                          placeholder={`${dim[0]!.toUpperCase() + dim.slice(1)} ${productPhysical[dim] ?? "—"} ${productPhysical.dimension_unit}`}
                          onChange={(e) => update(v.key, { [dim]: parseNum(e.target.value) })}
                          className="h-8 text-[12.5px]"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-[12px] text-muted-foreground">Variant Images</Label>
                  <p className="mb-1.5 text-[11px] text-muted-foreground">
                    Optional. Without variant images the product images are shown instead.
                  </p>
                  <ProductMediaManager
                    value={v.media}
                    onChange={(m) => update(v.key, { media: m })}
                    disabled={disabled ?? false}
                    compact
                    maxImages={6}
                    uploadLabel="Upload Variant Images"
                  />
                </div>
              </div>
            )}

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
