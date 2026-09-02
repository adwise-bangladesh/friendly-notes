import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaImage } from "./MediaImage";
import { searchProductOptions, primaryMedia } from "@/lib/products";
import { RELATIONSHIP_TYPE_LABELS } from "@/types/commerce";
import type { ProductRelationshipDraft, ProductRelationshipType } from "@/types/commerce";

interface Props {
  value: ProductRelationshipDraft[];
  onChange: (next: ProductRelationshipDraft[]) => void;
  currentProductId?: string;
  disabled?: boolean;
}

const TYPES: ProductRelationshipType[] = ["related", "upsell", "cross_sell"];

export function ProductRelationshipsEditor({
  value,
  onChange,
  currentProductId,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [type, setType] = useState<ProductRelationshipType>("related");

  const { data: options = [] } = useQuery({
    queryKey: ["product-options", term, currentProductId ?? null],
    queryFn: () => searchProductOptions(term, currentProductId),
    enabled: open,
    staleTime: 30_000,
  });

  const add = (option: (typeof options)[number]) => {
    const exists = value.some(
      (v) => v.related_product_id === option.id && v.relationship_type === type,
    );
    if (exists) return;
    onChange([
      ...value,
      {
        key: crypto.randomUUID(),
        related_product_id: option.id,
        relationship_type: type,
        name: option.name,
        thumbnail: primaryMedia(option.product_media ?? []),
      },
    ]);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          No linked products. Use these to suggest upsells, cross-sells or bundle contents.
        </p>
      )}

      {value.map((r) => (
        <div
          key={r.key}
          className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5"
        >
          <MediaImage path={r.thumbnail} alt={r.name} className="h-8 w-8 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[12.5px]">{r.name}</span>
          <Select
            value={r.relationship_type}
            disabled={disabled ?? false}
            onValueChange={(t) =>
              onChange(
                value.map((x) =>
                  x.key === r.key
                    ? { ...x, relationship_type: t as ProductRelationshipType }
                    : x,
                ),
              )
            }
          >
            <SelectTrigger className="h-7 w-[130px] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {RELATIONSHIP_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={disabled}
            aria-label="Remove link"
            onClick={() => onChange(value.filter((x) => x.key !== r.key))}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={type} onValueChange={(t) => setType(t as ProductRelationshipType)}>
            <SelectTrigger className="h-8 w-[150px] text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {RELATIONSHIP_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Link Product
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
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
                      <CommandItem
                        key={o.id}
                        value={o.id}
                        onSelect={() => add(o)}
                        className="gap-2 text-[12.5px]"
                      >
                        <MediaImage
                          path={primaryMedia(o.product_media ?? [])}
                          alt={o.name}
                          className="h-6 w-6"
                        />
                        <span className="truncate">{o.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
}
