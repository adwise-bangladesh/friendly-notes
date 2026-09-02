import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MediaImage } from "./MediaImage";
import { searchProductOptions, primaryMedia } from "@/lib/products";
import type { BundleItemDraft } from "@/types/commerce";

interface Props {
  value: BundleItemDraft[];
  onChange: (next: BundleItemDraft[]) => void;
  currentProductId?: string;
  disabled?: boolean;
}

export function BundleContentsEditor({ value, onChange, currentProductId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const { data: options = [] } = useQuery({
    queryKey: ["bundle-options", term, currentProductId ?? null],
    queryFn: () => searchProductOptions(term, currentProductId, { excludeBundles: true }),
    enabled: open,
    staleTime: 30_000,
  });

  const addProduct = (option: (typeof options)[number], variantId?: string) => {
    const exists = value.some((v) =>
      variantId ? v.variant_id === variantId : v.product_id === option.id && !v.variant_id,
    );
    if (exists) return;
    const variant = option.product_variants?.find((v) => v.id === variantId);
    onChange([
      ...value,
      {
        key: crypto.randomUUID(),
        product_id: variantId ? null : option.id,
        variant_id: variantId ?? null,
        quantity: 1,
        name: option.name,
        variant_title: variant?.title ?? null,
        thumbnail: primaryMedia(option.product_media ?? []),
      },
    ]);
    setOpen(false);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          No bundle contents yet. Add the products or variants included in this bundle and set how
          many of each are included.
        </p>
      )}

      {value.map((item, i) => (
        <div
          key={item.key}
          className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5"
        >
          <MediaImage path={item.thumbnail} alt={item.name} className="h-8 w-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px]">{item.name}</p>
            {item.variant_title && (
              <p className="truncate text-[11px] text-muted-foreground">
                Variant: {item.variant_title}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11.5px] text-muted-foreground">Qty</span>
            <Input
              value={item.quantity}
              disabled={disabled}
              inputMode="numeric"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^0-9]/g, "")) || 1;
                onChange(
                  value.map((x) => (x.key === item.key ? { ...x, quantity: Math.max(1, n) } : x)),
                );
              }}
              className="h-7 w-14 text-center text-[12.5px]"
            />
          </div>
          <div className="flex items-center">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled || i === 0}
              aria-label="Move up"
              onClick={() => move(i, -1)}
              className="h-7 w-7 text-muted-foreground"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled || i === value.length - 1}
              aria-label="Move down"
              onClick={() => move(i, 1)}
              className="h-7 w-7 text-muted-foreground"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled}
              aria-label="Remove bundle item"
              onClick={() => onChange(value.filter((x) => x.key !== item.key))}
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ))}

      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Bundle Item
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                value={term}
                onValueChange={setTerm}
                placeholder="Search products…"
                className="text-[13px]"
              />
              <CommandList>
                <CommandEmpty className="py-4 text-center text-[12.5px]">
                  No products found.
                </CommandEmpty>
                <CommandGroup>
                  {options.map((o) => (
                    <div key={o.id}>
                      <CommandItem
                        value={o.id}
                        onSelect={() => addProduct(o)}
                        className="gap-2 text-[12.5px]"
                      >
                        <MediaImage
                          path={primaryMedia(o.product_media ?? [])}
                          alt={o.name}
                          className="h-6 w-6"
                        />
                        <span className="truncate">{o.name}</span>
                      </CommandItem>
                      {(o.product_variants ?? []).map((v) => (
                        <CommandItem
                          key={v.id}
                          value={v.id}
                          onSelect={() => addProduct(o, v.id)}
                          className="gap-2 pl-9 text-[12px] text-muted-foreground"
                        >
                          <span className="truncate">{v.title}</span>
                        </CommandItem>
                      ))}
                    </div>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
