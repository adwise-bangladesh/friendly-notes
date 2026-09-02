import { useMemo, useState } from "react";
import { Check, Plus, Star, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { Category, ProductCategoryDraft } from "@/types/commerce";

interface Props {
  categories: Category[];
  value: ProductCategoryDraft[];
  onChange: (next: ProductCategoryDraft[]) => void;
  disabled?: boolean;
}

interface FlatCategory {
  id: string;
  name: string;
  depth: number;
  path: string;
  archived: boolean;
}

function flattenCategories(categories: Category[]): FlatCategory[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parent_id ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  const out: FlatCategory[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    const list = (byParent.get(parent) ?? []).sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
    for (const c of list) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ id: c.id, name: c.name, depth, path, archived: c.status === "archived" });
      walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  return out;
}

export function ProductCategoryPicker({ categories, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const flat = useMemo(() => flattenCategories(categories), [categories]);
  const byId = useMemo(() => new Map(flat.map((f) => [f.id, f])), [flat]);
  const selectedIds = new Set(value.map((v) => v.category_id));

  const toggle = (id: string) => {
    if (selectedIds.has(id)) {
      const next = value.filter((v) => v.category_id !== id);
      if (next.length && !next.some((n) => n.is_primary) && next[0]) next[0].is_primary = true;
      onChange([...next]);
    } else {
      onChange([...value, { category_id: id, is_primary: value.length === 0 }]);
    }
  };

  const setPrimary = (id: string) =>
    onChange(value.map((v) => ({ ...v, is_primary: v.category_id === id })));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((item) => {
            const meta = byId.get(item.category_id);
            return (
              <li
                key={item.category_id}
                className="flex items-center gap-2 rounded border border-border bg-muted/40 px-2 py-1.5"
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setPrimary(item.category_id)}
                  title={item.is_primary ? "Primary category" : "Set as primary"}
                  className={cn(
                    "shrink-0 rounded p-0.5 transition-colors",
                    item.is_primary
                      ? "text-warning-foreground"
                      : "text-muted-foreground/50 hover:text-foreground",
                  )}
                >
                  <Star className={cn("h-3.5 w-3.5", item.is_primary && "fill-current")} />
                </button>
                <span className="min-w-0 flex-1 truncate text-[12.5px]">
                  {meta?.path ?? "Unknown category"}
                  {meta?.archived && (
                    <span className="ml-1 text-[11px] text-muted-foreground">(archived)</span>
                  )}
                </span>
                {item.is_primary && (
                  <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                    Primary
                  </span>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => toggle(item.category_id)}
                    aria-label="Remove category"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full justify-start">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Category
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search categories…" className="text-[13px]" />
              <CommandList>
                <CommandEmpty className="py-4 text-center text-[12.5px]">
                  No categories found.
                </CommandEmpty>
                <CommandGroup>
                  {flat.map((c) => {
                    const checked = selectedIds.has(c.id);
                    const blocked = c.archived && !checked;
                    return (
                      <CommandItem
                        key={c.id}
                        value={c.path}
                        disabled={blocked}
                        onSelect={() => !blocked && toggle(c.id)}
                        className="text-[12.5px]"
                      >
                        <span style={{ paddingLeft: c.depth * 12 }} className="flex items-center">
                          {c.depth > 0 && <span className="mr-1 text-muted-foreground">└</span>}
                          {c.name}
                        </span>
                        {c.archived && (
                          <span className="ml-2 text-[11px] text-muted-foreground">archived</span>
                        )}
                        {checked && <Check className="ml-auto h-3.5 w-3.5" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {value.length === 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          No categories assigned. Recommended, but not required.
        </p>
      )}
    </div>
  );
}
