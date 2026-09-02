import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
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
import { ProductCategoryPicker } from "./ProductCategoryPicker";
import { ProductMediaManager } from "./ProductMediaManager";
import { ProductVariantsEditor } from "./ProductVariantsEditor";
import { ProductRelationshipsEditor } from "./ProductRelationshipsEditor";
import { getBrands, getCategories, toSlug } from "@/lib/commerce";
import { saveProduct, primaryMedia } from "@/lib/products";
import { CURRENCY_SYMBOL, formatMoney, parseMoney } from "@/lib/currency";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  PRODUCT_STATUS_LABELS,
  PRODUCT_TYPE_HELP,
  PRODUCT_TYPE_LABELS,
  SUPPLY_MODEL_HELP,
  SUPPLY_MODEL_LABELS,
  VISIBILITY_LABELS,
} from "@/types/commerce";
import type {
  EntityVisibility,
  ProductDraft,
  ProductEditorRecord,
  ProductStatus,
  ProductType,
  SupplyModel,
} from "@/types/commerce";

const EMPTY_DRAFT: ProductDraft = {
  name: "",
  slug: "",
  sku: null,
  short_description: null,
  description: null,
  brand_id: null,
  product_type: "simple",
  supply_model: "in_stock",
  status: "draft",
  visibility: "visible",
  featured: false,
  price: 0,
  compare_at_price: null,
  categories: [],
  media: [],
  variants: [],
  relationships: [],
};

function toDraft(record: ProductEditorRecord): ProductDraft {
  return {
    name: record.name,
    slug: record.slug,
    sku: record.sku ?? null,
    short_description: record.short_description,
    description: record.description,
    brand_id: record.brand_id,
    product_type: record.product_type,
    supply_model: record.supply_model,
    status: record.status,
    visibility: record.visibility,
    featured: record.featured,
    price: record.price ?? 0,
    compare_at_price: record.compare_at_price ?? null,
    categories: [...record.product_categories]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({ category_id: c.category_id, is_primary: c.is_primary })),
    media: [...record.product_media]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({
        key: m.id,
        url: m.url,
        alt_text: m.alt_text,
        is_primary: m.is_primary,
      })),
    variants: [...record.product_variants]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        key: v.id,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        price: v.price ?? null,
        compare_at_price: v.compare_at_price ?? null,
        status: v.status,
      })),
    relationships: [...record.product_relationships]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({
        key: r.id,
        related_product_id: r.related_product_id,
        relationship_type: r.relationship_type,
        name: r.related_product?.name ?? "Unknown product",
        thumbnail: primaryMedia(r.related_product?.product_media ?? []),
      })),
  };
}

interface Props {
  record?: ProductEditorRecord;
}

export function ProductEditor({ record }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();
  const readOnly = !canManage;

  const [draft, setDraft] = useState<ProductDraft>(() =>
    record ? toDraft(record) : { ...EMPTY_DRAFT },
  );
  const [slugTouched, setSlugTouched] = useState(!!record);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  // Auto-slug from name until the user edits the slug manually.
  useEffect(() => {
    if (!slugTouched) setDraft((d) => ({ ...d, slug: toSlug(d.name) }));
  }, [draft.name, slugTouched]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });
  const { data: brands = [] } = useQuery({ queryKey: ["brands"], queryFn: () => getBrands() });

  const activeBrands = useMemo(
    () => brands.filter((b) => b.status !== "archived" || b.id === draft.brand_id),
    [brands, draft.brand_id],
  );

  const variantRange = useMemo(() => {
    const prices = draft.variants
      .map((v) => v.price)
      .filter((p): p is number => p !== null && p !== undefined);
    if (!prices.length) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [draft.variants]);

  const mutation = useMutation({
    mutationFn: (next: ProductDraft) => saveProduct(next, record?.id),
    onSuccess: (id) => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product", id] });
      queryClient.invalidateQueries({ queryKey: ["category-product-counts"] });
      queryClient.invalidateQueries({ queryKey: ["brand-product-counts"] });
      toast.success(record ? "Product updated" : "Product created");
      if (!record) void navigate({ to: "/products/$id", params: { id } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save product"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(draft);
  };

  const discount =
    draft.compare_at_price && draft.compare_at_price > draft.price
      ? Math.round(((draft.compare_at_price - draft.price) / draft.compare_at_price) * 100)
      : null;

  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-5">
        <div className="rounded-md border border-border bg-card p-4">
          <FormSection title="Basic Information">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-[12.5px]">
                Product Name *
              </Label>
              <Input
                id="name"
                value={draft.name}
                disabled={readOnly}
                required
                onChange={(e) => set("name", e.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="slug" className="text-[12.5px]">
                  Slug *
                </Label>
                <Input
                  id="slug"
                  value={draft.slug}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug", e.target.value);
                  }}
                  onBlur={(e) => set("slug", toSlug(e.target.value))}
                  className="h-8 font-mono text-[12.5px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sku" className="text-[12.5px]">
                  Product SKU
                </Label>
                <Input
                  id="sku"
                  value={draft.sku ?? ""}
                  disabled={readOnly}
                  placeholder="Optional"
                  onChange={(e) => set("sku", e.target.value || null)}
                  className="h-8 font-mono text-[12.5px]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="short" className="text-[12.5px]">
                Short Description
              </Label>
              <Textarea
                id="short"
                value={draft.short_description ?? ""}
                disabled={readOnly}
                rows={2}
                maxLength={280}
                onChange={(e) => set("short_description", e.target.value || null)}
                className="text-[12.5px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc" className="text-[12.5px]">
                Full Description
              </Label>
              <Textarea
                id="desc"
                value={draft.description ?? ""}
                disabled={readOnly}
                rows={6}
                onChange={(e) => set("description", e.target.value || null)}
                className="text-[12.5px]"
              />
            </div>
          </FormSection>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <FormSection title="Pricing" description={`All amounts are in ${CURRENCY_SYMBOL} BDT.`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="price" className="text-[12.5px]">
                  Selling Price *
                </Label>
                <Input
                  id="price"
                  value={draft.price}
                  disabled={readOnly}
                  inputMode="decimal"
                  onChange={(e) => set("price", parseMoney(e.target.value) ?? 0)}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="compare" className="text-[12.5px]">
                  Compare-at Price
                </Label>
                <Input
                  id="compare"
                  value={draft.compare_at_price ?? ""}
                  disabled={readOnly}
                  inputMode="decimal"
                  placeholder="Optional"
                  onChange={(e) => set("compare_at_price", parseMoney(e.target.value))}
                  className="h-8 text-[13px]"
                />
              </div>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              {discount
                ? `Shows as ${discount}% off (${formatMoney(draft.compare_at_price)} → ${formatMoney(draft.price)}).`
                : "Set a higher compare-at price to display a discount."}
              {draft.product_type === "variable" && variantRange && (
                <>
                  {" "}
                  Variant range: {formatMoney(variantRange.min)} – {formatMoney(variantRange.max)}.
                </>
              )}
            </p>
          </FormSection>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <FormSection
            title="Media"
            description="Upload product photography. The first/starred image is the thumbnail."
          >
            <ProductMediaManager
              value={draft.media}
              onChange={(m) => set("media", m)}
              disabled={readOnly}
            />
          </FormSection>
        </div>

        {draft.product_type === "variable" && (
          <div className="rounded-md border border-border bg-card p-4">
            <FormSection
              title="Variants"
              description="Each variant is separately purchasable and can carry its own SKU and price."
            >
              <ProductVariantsEditor
                value={draft.variants}
                onChange={(v) => set("variants", v)}
                disabled={readOnly}
              />
            </FormSection>
          </div>
        )}

        <div className="rounded-md border border-border bg-card p-4">
          <FormSection
            title="Related Products"
            description="Link upsells, cross-sells, bundle contents or generally related items."
          >
            <ProductRelationshipsEditor
              value={draft.relationships}
              onChange={(r) => set("relationships", r)}
              {...(record?.id ? { currentProductId: record.id } : {})}
              disabled={readOnly}
            />
          </FormSection>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-md border border-border bg-card p-4">
          <FormSection title="Publishing">
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Status</Label>
              <Select
                value={draft.status}
                disabled={readOnly}
                onValueChange={(v) => set("status", v as ProductStatus)}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["draft", "active", "inactive", "archived"] as ProductStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {PRODUCT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Visibility</Label>
              <Select
                value={draft.visibility}
                disabled={readOnly}
                onValueChange={(v) => set("visibility", v as EntityVisibility)}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["visible", "hidden"] as EntityVisibility[]).map((v) => (
                    <SelectItem key={v} value={v}>
                      {VISIBILITY_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded border border-border px-2.5 py-2">
              <Label htmlFor="featured" className="text-[12.5px]">
                Featured
              </Label>
              <Switch
                id="featured"
                checked={draft.featured}
                disabled={readOnly}
                onCheckedChange={(v) => set("featured", v)}
              />
            </div>
          </FormSection>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <FormSection title="Organisation">
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Product Type</Label>
              <Select
                value={draft.product_type}
                disabled={readOnly}
                onValueChange={(v) => set("product_type", v as ProductType)}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    ["simple", "variable", "bundle", "service", "digital"] as ProductType[]
                  ).map((t) => (
                    <SelectItem key={t} value={t}>
                      {PRODUCT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11.5px] text-muted-foreground">
                {PRODUCT_TYPE_HELP[draft.product_type]}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Supply Model</Label>
              <Select
                value={draft.supply_model}
                disabled={readOnly}
                onValueChange={(v) => set("supply_model", v as SupplyModel)}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["in_stock", "local_sourcing", "preorder"] as SupplyModel[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SUPPLY_MODEL_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11.5px] text-muted-foreground">
                {SUPPLY_MODEL_HELP[draft.supply_model]}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Brand</Label>
              <Select
                value={draft.brand_id ?? "none"}
                disabled={readOnly}
                onValueChange={(v) => set("brand_id", v === "none" ? null : v)}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No brand</SelectItem>
                  {activeBrands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">Categories</Label>
              <ProductCategoryPicker
                categories={categories}
                value={draft.categories}
                onChange={(c) => set("categories", c)}
                disabled={readOnly}
              />
            </div>
          </FormSection>
        </div>

        {!readOnly && (
          <div className="sticky bottom-4 rounded-md border border-border bg-card p-3">
            <Button type="submit" size="sm" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              {record ? "Save Changes" : "Create Product"}
            </Button>
            {dirty && (
              <p className="mt-1.5 text-center text-[11.5px] text-muted-foreground">
                Unsaved changes
              </p>
            )}
          </div>
        )}
      </aside>
    </form>
  );
}
