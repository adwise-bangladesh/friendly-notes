import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { createBrand, isSlugAvailable, toSlug, updateBrand } from "@/lib/commerce";
import type { Brand, BrandType, EntityVisibility } from "@/types/commerce";

export interface BrandFormState {
  mode: "create" | "edit";
  brand?: Brand;
}

interface Props {
  state: BrandFormState | null;
  onClose: () => void;
}

export function BrandFormPanel({ state, onClose }: Props) {
  const qc = useQueryClient();
  const editing = state?.mode === "edit" ? state.brand : undefined;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [brandType, setBrandType] = useState<BrandType>("standard");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
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
    setBrandType(editing?.brand_type ?? "standard");
    setShortDescription(editing?.short_description ?? "");
    setDescription(editing?.description ?? "");
    setWebsite(editing?.website ?? "");
    setLogo(editing?.logo_url ?? null);
    setBanner(editing?.banner_url ?? null);
    setFeatured(editing?.featured ?? false);
    setSortOrder(editing?.sort_order ?? 0);
    setStatus(editing && editing.status === "inactive" ? "inactive" : "active");
    setVisibility(editing?.visibility ?? "visible");
  }, [state, editing]);

  useEffect(() => {
    if (!slugTouched) setSlug(toSlug(name));
  }, [name, slugTouched]);

  const mutation = useMutation({
    mutationFn: async () => {
      const cleanName = name.trim();
      const cleanSlug = toSlug(slug || cleanName);
      if (!cleanName) throw new Error("Brand name is required.");
      if (!cleanSlug) throw new Error("A valid slug is required.");

      let cleanWebsite: string | null = website.trim() || null;
      if (cleanWebsite) {
        if (!/^https?:\/\//i.test(cleanWebsite)) cleanWebsite = `https://${cleanWebsite}`;
        try {
          new URL(cleanWebsite);
        } catch {
          throw new Error("Website must be a valid URL.");
        }
      }

      const available = await isSlugAvailable("brands", cleanSlug, editing?.id);
      if (!available) throw new Error(`The slug "${cleanSlug}" is already in use.`);

      const payload = {
        name: cleanName,
        slug: cleanSlug,
        brand_type: brandType,
        short_description: shortDescription.trim() || null,
        description: description.trim() || null,
        website: cleanWebsite,
        logo_url: logo,
        banner_url: banner,
        featured,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        status,
        visibility,
      };

      return editing ? updateBrand(editing.id, payload) : createBrand(payload);
    },
    onSuccess: (brand) => {
      void qc.invalidateQueries({ queryKey: ["brands"] });
      void qc.invalidateQueries({ queryKey: ["brand-counts"] });
      toast.success(editing ? `Updated ${brand.name}` : `Created ${brand.name}`);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not save brand."),
  });

  return (
    <Sheet open={!!state} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base">{editing ? "Edit brand" : "Add brand"}</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {editing
              ? "Update this brand's details and availability."
              : "Create a brand to organise branded products."}
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
              <Label htmlFor="brand-name" className="text-[12.5px]">
                Brand name *
              </Label>
              <Input
                id="brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-slug" className="text-[12.5px]">
                Slug
              </Label>
              <Input
                id="brand-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Brand type</Label>
              <Select value={brandType} onValueChange={(v) => setBrandType(v as BrandType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="own_brand">Own Brand</SelectItem>
                  <SelectItem value="generic">Generic</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11.5px] text-muted-foreground">
                Standard: third-party brand. Own Brand: your in-house label. Generic: unbranded
                goods sold under a generic label.
              </p>
            </div>
          </FormSection>

          <FormSection title="Content">
            <div className="space-y-1.5">
              <Label htmlFor="brand-short" className="text-[12.5px]">
                Short description
              </Label>
              <Input
                id="brand-short"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-desc" className="text-[12.5px]">
                Description
              </Label>
              <Textarea
                id="brand-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-web" className="text-[12.5px]">
                Website
              </Label>
              <Input
                id="brand-web"
                placeholder="https://example.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
          </FormSection>

          <FormSection title="Media">
            <ImageUploadField
              label="Logo"
              hint="Square image recommended (e.g. 400×400)."
              folder={`brands/${editing?.id ?? "new"}/logo`}
              value={logo}
              onChange={setLogo}
            />
            <ImageUploadField
              label="Banner image"
              hint="Wide image recommended (e.g. 1600×500)."
              aspect="wide"
              folder={`brands/${editing?.id ?? "new"}/banner`}
              value={banner}
              onChange={setBanner}
            />
          </FormSection>

          <FormSection title="Display settings">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[12.5px]">Featured</Label>
                <p className="text-[11.5px] text-muted-foreground">
                  Highlight this brand in curated placements.
                </p>
              </div>
              <Switch checked={featured} onCheckedChange={setFeatured} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-sort" className="text-[12.5px]">
                Sort order
              </Label>
              <Input
                id="brand-sort"
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
              {editing ? "Save changes" : "Create brand"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
