import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "./FormSection";
import { ImageUploadField } from "./ImageUploadField";
import {
  createCategory,
  isSlugAvailable,
  toSlug,
  updateCategory,
} from "@/lib/commerce";
import type { Category, EntityVisibility } from "@/types/commerce";

const NO_PARENT = "__none__";

export interface CategoryFormState {
  mode: "create" | "edit";
  category?: Category;
  parentId?: string | null;
}

interface Props {
  state: CategoryFormState | null;
  onClose: () => void;
  categories: Category[];
}

function descendantIds(all: Category[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

function pathOf(all: Category[], id: string | null): Category[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const chain: Category[] = [];
  let cur = id ? byId.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 50) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}

export function CategoryFormPanel({ state, onClose, categories }: Props) {
  const qc = useQueryClient();
  const editing = state?.mode === "edit" ? state.category : undefined;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string>(NO_PARENT);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [featured, setFeatured] = useState(false);
  const [sortOrder, setSortOrder] = useState(0);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [visibility, setVisibility] = useState<EntityVisibility>("visible");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setError(null);
    setSlugTouched(!!editing);
    setName(editing?.name ?? "");
    setSlug(editing?.slug ?? "");
    setShortDescription(editing?.short_description ?? "");
    setDescription(editing?.description ?? "");
    setParentId(editing?.parent_id ?? state.parentId ?? NO_PARENT);
    setThumbnail(editing?.thumbnail_url ?? null);
    setBanner(editing?.banner_url ?? null);
    setFeatured(editing?.featured ?? false);
    setSortOrder(editing?.sort_order ?? 0);
    setStatus(editing && editing.status === "inactive" ? "inactive" : "active");
    setVisibility(editing?.visibility ?? "visible");
  }, [state, editing]);

  useEffect(() => {
    if (!slugTouched) setSlug(toSlug(name));
  }, [name, slugTouched]);

  const blocked = useMemo(
    () => (editing ? descendantIds(categories, editing.id) : new Set<string>()),
    [categories, editing],
  );

  const parentOptions = useMemo(
    () =>
      categories
        .filter((c) => !blocked.has(c.id) && c.status !== "archived")
        .map((c) => ({ id: c.id, label: pathOf(categories, c.id).map((x) => x.name).join(" → ") }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories, blocked],
  );

  const previewPath = useMemo(() => {
    const chain = parentId === NO_PARENT ? [] : pathOf(categories, parentId).map((c) => c.name);
    return [...chain, name || "New category"];
  }, [categories, parentId, name]);

  const depthWarning = previewPath.length > 3;

  const mutation = useMutation({
    mutationFn: async () => {
      const cleanName = name.trim();
      const cleanSlug = toSlug(slug || cleanName);
      if (!cleanName) throw new Error("Category name is required.");
      if (!cleanSlug) throw new Error("A valid slug is required.");
      const available = await isSlugAvailable("categories", cleanSlug, editing?.id);
      if (!available) throw new Error(`The slug "${cleanSlug}" is already in use.`);

      const payload = {
        name: cleanName,
        slug: cleanSlug,
        short_description: shortDescription.trim() || null,
        description: description.trim() || null,
        parent_id: parentId === NO_PARENT ? null : parentId,
        thumbnail_url: thumbnail,
        banner_url: banner,
        featured,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        status,
        visibility,
      };

      return editing ? updateCategory(editing.id, payload) : createCategory(payload);
    },
    onSuccess: (cat) => {
      void qc.invalidateQueries({ queryKey: ["categories"] });
      void qc.invalidateQueries({ queryKey: ["category-counts"] });
      toast.success(editing ? `Updated ${cat.name}` : `Created ${cat.name}`);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not save category."),
  });

  return (
    <Sheet open={!!state} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base">
            {editing ? "Edit category" : "Add category"}
          </SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {editing
              ? "Update this category's details, placement and availability."
              : "Create a category to organise the catalog."}
          </SheetDescription>
        </SheetHeader>

        <form
          className="flex-1 space-y-5 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <FormSection title="Basic information">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name" className="text-[12.5px]">
                Category name *
              </Label>
              <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-slug" className="text-[12.5px]">
                Slug
              </Label>
              <Input
                id="cat-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
              <p className="text-[11.5px] text-muted-foreground">
                Auto-generated from the name; edit it to keep a custom URL.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-short" className="text-[12.5px]">
                Short description
              </Label>
              <Input
                id="cat-short"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-desc" className="text-[12.5px]">
                Description
              </Label>
              <Textarea
                id="cat-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </FormSection>

          <FormSection title="Hierarchy">
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Parent category</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger>
                  <SelectValue placeholder="No parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>No parent (top level)</SelectItem>
                  {parentOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded border border-border bg-muted/50 px-3 py-2 text-[12px]">
              {previewPath.map((seg, i) => (
                <div key={i} style={{ paddingLeft: i * 12 }} className="leading-5">
                  {i > 0 && <span className="text-muted-foreground">→ </span>}
                  {seg}
                </div>
              ))}
            </div>
            {depthWarning && (
              <div className="flex gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This will create a category deeper than the recommended 3-level structure.
                </span>
              </div>
            )}
          </FormSection>

          <FormSection title="Media">
            <ImageUploadField
              label="Thumbnail image"
              hint="Square image recommended (e.g. 400×400). Used in admin lists and category grids."
              folder={`categories/${editing?.id ?? "new"}/thumbnail`}
              value={thumbnail}
              onChange={setThumbnail}
            />
            <ImageUploadField
              label="Banner image"
              hint="Wide image recommended (e.g. 1600×500). Used on category pages later."
              aspect="wide"
              folder={`categories/${editing?.id ?? "new"}/banner`}
              value={banner}
              onChange={setBanner}
            />
          </FormSection>

          <FormSection title="Display settings">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[12.5px]">Featured</Label>
                <p className="text-[11.5px] text-muted-foreground">
                  Highlight this category in curated placements.
                </p>
              </div>
              <Switch checked={featured} onCheckedChange={setFeatured} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-sort" className="text-[12.5px]">
                Sort order
              </Label>
              <Input
                id="cat-sort"
                type="number"
                className="w-28"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </FormSection>

          <FormSection title="Availability">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as "active" | "inactive")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px]">Visibility</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as EntityVisibility)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="visible">Visible</SelectItem>
                    <SelectItem value="hidden">Hidden</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Visible: available for future storefront and mobile discovery. Hidden: managed
              internally, never publicly exposed.
            </p>
          </FormSection>

          {error && (
            <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-border bg-background px-5 py-3">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {editing ? "Save changes" : "Create category"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
