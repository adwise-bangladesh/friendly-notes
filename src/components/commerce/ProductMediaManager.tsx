import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Star, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaImage } from "./MediaImage";
import { uploadCommerceMedia } from "@/lib/media";
import { cn } from "@/lib/utils";
import type { ProductMediaDraft } from "@/types/commerce";

interface Props {
  value: ProductMediaDraft[];
  onChange: (next: ProductMediaDraft[]) => void;
  disabled?: boolean;
}

const MAX_IMAGES = 10;

export function ProductMediaManager({ value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const normalise = (list: ProductMediaDraft[]) =>
    list.length && !list.some((m) => m.is_primary)
      ? list.map((m, i) => ({ ...m, is_primary: i === 0 }))
      : list;

  const handleFiles = async (files: FileList) => {
    const room = MAX_IMAGES - value.length;
    if (room <= 0) {
      toast.error(`Maximum ${MAX_IMAGES} images per product.`);
      return;
    }
    setBusy(true);
    const added: ProductMediaDraft[] = [];
    try {
      for (const file of Array.from(files).slice(0, room)) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} is larger than 10MB.`);
          continue;
        }
        const url = await uploadCommerceMedia("products", file);
        added.push({
          key: crypto.randomUUID(),
          url,
          alt_text: null,
          is_primary: value.length === 0 && added.length === 0,
        });
      }
      if (added.length) {
        onChange(normalise([...value, ...added]));
        toast.success(`${added.length} image${added.length > 1 ? "s" : ""} uploaded`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const move = (index: number, delta: number) => {
    const next = [...value];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  const remove = (key: string) =>
    onChange(normalise(value.filter((m) => m.key !== key)));

  const setPrimary = (key: string) =>
    onChange(value.map((m) => ({ ...m, is_primary: m.key === key })));

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {value.map((m, i) => (
            <li
              key={m.key}
              className={cn(
                "space-y-1.5 rounded border p-1.5",
                m.is_primary ? "border-primary/60 bg-primary/5" : "border-border",
              )}
            >
              <MediaImage path={m.url} alt={m.alt_text ?? "Product image"} className="h-24 w-full" />
              <Input
                value={m.alt_text ?? ""}
                disabled={disabled}
                placeholder="Alt text"
                onChange={(e) =>
                  onChange(
                    value.map((x) =>
                      x.key === m.key ? { ...x, alt_text: e.target.value || null } : x,
                    ),
                  )
                }
                className="h-7 text-[11.5px]"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setPrimary(m.key)}
                  title={m.is_primary ? "Primary image" : "Set as primary"}
                  className={cn(
                    "rounded p-1",
                    m.is_primary
                      ? "text-warning-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Star className={cn("h-3.5 w-3.5", m.is_primary && "fill-current")} />
                </button>
                <div className="flex items-center">
                  <button
                    type="button"
                    disabled={disabled || i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Move left"
                    className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled || i === value.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move right"
                    className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => remove(m.key)}
                    aria-label="Remove image"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || value.length >= MAX_IMAGES}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-3.5 w-3.5" />
          )}
          Upload Images
        </Button>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        {value.length}/{MAX_IMAGES} images. The starred image is used as the thumbnail.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
        }}
      />
    </div>
  );
}
