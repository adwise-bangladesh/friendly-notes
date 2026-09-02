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
import { BundleContentsEditor } from "./BundleContentsEditor";
import { GroupBuyCampaigns } from "./GroupBuyCampaigns";
import { getBrands, getCategories, toSlug } from "@/lib/commerce";
import { saveProduct, primaryMedia } from "@/lib/products";
import { CURRENCY_SYMBOL, formatMoney, parseMoney } from "@/lib/currency";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  DIMENSION_UNITS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_TYPE_HELP,
  PRODUCT_TYPE_LABELS,
  SUPPLY_MODELS,
  SUPPLY_MODEL_HELP,
  SUPPLY_MODEL_LABELS,
  VISIBILITY_LABELS,
  WEIGHT_UNITS,
  defaultRequiresShipping,
  estimatedMargin,
  landedCost,
} from "@/types/commerce";
import type {
  DimensionUnit,
  EntityVisibility,
  ProductDraft,
  ProductEditorRecord,
  ProductStatus,
  ProductType,
  SupplyModel,
  WeightUnit,
} from "@/types/commerce";

const EMPTY_DRAFT: ProductDraft = {
  name: "",
  slug: "",
  sku: null,
  barcode: null,
  short_description: null,
  description: null,
  brand_id: null,
  product_type: "simple",
  supply_model: "in_stock",
  status: "draft",
  visibility: "visible",
  featured: false,
  is_purchasable: false,
  price: 0,
  compare_at_price: null,
  base_cost: 0,
  additional_cost: 0,
  weight: null,
  weight_unit: "kg",
  length: null,
  width: null,
  height: null,
  dimension_unit: "cm",
  requires_shipping: true,
  categories: [],
  media: [],
  variants: [],
  relationships: [],
  bundle_items: [],
};

function toDraft(record: ProductEditorRecord): ProductDraft {
  return {
    name: record.name,
    slug: record.slug,
    sku: record.sku ?? null,
    barcode: record.barcode ?? null,
    short_description: record.short_description,
    description: record.description,
    brand_id: record.brand_id,
    product_type: record.product_type,
    supply_model: record.supply_model,
    status: record.status,
    visibility: record.visibility,
    featured: record.featured,
    is_purchasable: record.is_purchasable,
    price: record.price ?? 0,
    compare_at_price: record.compare_at_price ?? null,
    base_cost: record.base_cost ?? 0,
    additional_cost: record.additional_cost ?? 0,
    weight: record.weight ?? null,
    weight_unit: (record.weight_unit as WeightUnit) ?? "kg",
    length: record.length ?? null,
    width: record.width ?? null,
    height: record.height ?? null,
    dimension_unit: (record.dimension_unit as DimensionUnit) ?? "cm",
    requires_shipping: record.requires_shipping,
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
        base_cost: v.base_cost ?? null,
        additional_cost: v.additional_cost ?? null,
        weight: v.weight ?? null,
        length: v.length ?? null,
        width: v.width ?? null,
        height: v.height ?? null,
        media: [...(v.product_media ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((m) => ({
            key: m.id,
            url: m.url,
            alt_text: m.alt_text,
            is_primary: m.is_primary,
          })),
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
    bundle_items: [...(record.bundle_items ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((b) => ({
        key: b.id,
        product_id: b.product_id,
        variant_id: b.variant_id,
        quantity: b.quantity,
        name: b.variant?.product?.name ?? b.product?.name ?? "Unknown product",
        variant_title: b.variant?.title ?? null,
        thumbnail: primaryMedia(b.variant?.product_media ?? b.product?.product_media ?? []),
      })),
  };
}

const parseNum = (v: string): number | null => {
  const cleaned = v.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

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

  // Changing the product type applies the sensible shipping default.
  const setProductType = (t: ProductType) => {
    setDraft((d) => ({ ...d, product_type: t, requires_shipping: defaultRequiresShipping(t) }));
    setDirty(true);
  };

  // Archived products can never stay purchasable (mirrors the DB rule).
  const setStatus = (s: ProductStatus) => {
    setDraft((d) => ({
      ...d,
      status: s,
      is_purchasable: s === "archived" ? false : d.is_purchasable,
    }));
    setDirty(true);
  };

  useEffect(() => {
    if (!slugTouched) setDraft((d) => ({ ...d, slug: toSlug(d.name) }));
  }, [draft.name, slugTouched]);

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

  const isVariable = draft.product_type === "variable";
  const isBundle = draft.product_type === "bundle";
  const isPhysical = draft.requires_shipping;
  const isGroupBuy = draft.supply_model === "group_buy";

  const discountAmount =
    draft.compare_at_price && draft.compare_at_price > draft.price
      ? draft.compare_at_price - draft.price
      : null;
  const discountPct =
    discountAmount && draft.compare_at_price
      ? Math.round((discountAmount / draft.compare_at_price) * 100)
      : null;
  const compareTooLow =
    draft.compare_at_price !== null && draft.compare_at_price > 0 && draft.compare_at_price < draft.price;

  const landed = landedCost(draft.base_cost, draft.additional_cost);
  const margin = estimatedMargin(draft.price, landed);

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
            <div className="grid gap-3 sm:grid-cols-3">
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
                  placeholder={isVariable ? "Optional catalog code" : "Optional"}
                  onChange={(e) => set("sku", e.target.value || null)}
                  className="h-8 font-mono text-[12.5px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="barcode" className="text-[12.5px]">
                  Product Barcode
                </Label>
                <Input
                  id="barcode"
                  value={draft.barcode ?? ""}
                  disabled={readOnly}
                  placeholder="Optional"
                  onChange={(e) => set("barcode", e.target.value || null)}
                  className="h-8 font-mono text-[12.5px]"
                />
              </div>
            </div>
            {isVariable && (
              <p className="text-[11.5px] text-muted-foreground">
                Variants carry the sellable SKU and barcode. The product-level codes are optional
                catalog identifiers.
              </p>
            )}
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

        <div className="rounded-md border border-border bg-card p-4">
          <FormSection
            title="Pricing &amp; Costs"
            description={`All amounts are in ${CURRENCY_SYMBOL} BDT. Cost fields are internal and never shown to customers.`}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="price" className="text-[12.5px]">
                  Regular Selling Price *
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
                  placeholder="Optional reference price"
                  onChange={(e) => set("compare_at_price", parseMoney(e.target.value))}
                  className="h-8 text-[13px]"
                />
              </div>
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              {discountAmount && discountPct
                ? `Customer sees ${formatMoney(draft.compare_at_price)} → ${formatMoney(draft.price)} · ${formatMoney(discountAmount)} OFF · ${discountPct}% OFF.`
                : "Set a higher compare-at price to display a discount."}
              {isVariable && variantRange && (
                <>
                  {" "}
                  Variant range: {formatMoney(variantRange.min)} – {formatMoney(variantRange.max)}.
                </>
              )}
            </p>
            {compareTooLow && (
              <p className="text-[11.5px] text-warning-foreground">
                Compare-at price is lower than the selling price — no discount will be shown.
              </p>
            )}
            {isVariable && (
              <p className="rounded border border-dashed border-border px-2.5 py-2 text-[11.5px] text-muted-foreground">
                Prices are managed per variant. The product price is only used as a “from” reference.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="base_cost" className="text-[12.5px]">
                  Base Product Cost
                </Label>
                <Input
                  id="base_cost"
                  value={draft.base_cost}
                  disabled={readOnly}
                  inputMode="decimal"
                  onChange={(e) => set("base_cost", parseMoney(e.target.value) ?? 0)}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="additional_cost" className="text-[12.5px]">
                  Additional Cost
                </Label>
                <Input
                  id="additional_cost"
                  value={draft.additional_cost}
                  disabled={readOnly}
                  inputMode="decimal"
                  placeholder="Import, shipping, customs, handling"
                  onChange={(e) => set("additional_cost", parseMoney(e.target.value) ?? 0)}
                  className="h-8 text-[13px]"
                />
              </div>
            </div>

            <dl className="space-y-1 rounded border border-border bg-muted/30 px-3 py-2.5 text-[12.5px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Base Product Cost</dt>
                <dd>{formatMoney(draft.base_cost)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Additional Cost</dt>
                <dd>{formatMoney(draft.additional_cost)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-1 font-medium">
                <dt>Estimated Landed Cost</dt>
                <dd>{formatMoney(landed)}</dd>
              </div>
              <div className="flex justify-between pt-1">
                <dt className="text-muted-foreground">Regular Selling Price</dt>
                <dd>{formatMoney(draft.price)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-1 font-medium">
                <dt>Estimated Product Margin</dt>
                <dd>
                  {formatMoney(margin.margin)}
                  {margin.percentage !== null && ` (${margin.percentage.toFixed(1)}%)`}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-muted-foreground">
              Estimated only. Courier, packaging, discounts, payment fees, advertising and returns
              are not included and will be handled at order level later.
            </p>
          </FormSection>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <FormSection
            title="Physical Information"
            description="Used later for courier booking and shipping calculations."
          >
            <div className="flex items-center justify-between rounded border border-border px-2.5 py-2">
              <Label htmlFor="requires_shipping" className="text-[12.5px]">
                Requires Shipping
              </Label>
              <Switch
                id="requires_shipping"
                checked={draft.requires_shipping}
                disabled={readOnly}
                onCheckedChange={(v) => set("requires_shipping", v)}
              />
            </div>
            {!isPhysical ? (
              <p className="text-[11.5px] text-muted-foreground">
                No shipping required — weight and dimensions are not needed for this product.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[12.5px]">Weight</Label>
                    <div className="flex gap-2">
                      <Input
                        value={draft.weight ?? ""}
                        disabled={readOnly}
                        inputMode="decimal"
                        placeholder="0.00"
                        onChange={(e) => set("weight", parseNum(e.target.value))}
                        className="h-8 text-[12.5px]"
                      />
                      <Select
                        value={draft.weight_unit}
                        disabled={readOnly}
                        onValueChange={(v) => set("weight_unit", v as WeightUnit)}
                      >
                        <SelectTrigger className="h-8 w-[80px] text-[12.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEIGHT_UNITS.map((u) => (
                            <SelectItem key={u} value={u}>
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[12.5px]">Dimension Unit</Label>
                    <Select
                      value={draft.dimension_unit}
                      disabled={readOnly}
                      onValueChange={(v) => set("dimension_unit", v as DimensionUnit)}
                    >
                      <SelectTrigger className="h-8 text-[12.5px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DIMENSION_UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["length", "width", "height"] as const).map((dim) => (
                    <div key={dim} className="space-y-1.5">
                      <Label className="text-[12.5px] capitalize">
                        {dim} ({draft.dimension_unit})
                      </Label>
                      <Input
                        value={draft[dim] ?? ""}
                        disabled={readOnly}
                        inputMode="decimal"
                        placeholder="0.00"
                        onChange={(e) => set(dim, parseNum(e.target.value))}
                        className="h-8 text-[12.5px]"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </FormSection>
        </div>

        {isVariable && (
          <div className="rounded-md border border-border bg-card p-4">
            <FormSection
              title="Variants"
              description="Each variant is separately purchasable with its own price, and optional cost, physical and image overrides."
            >
              <ProductVariantsEditor
                value={draft.variants}
                onChange={(v) => set("variants", v)}
                disabled={readOnly}
                productCost={{
                  base_cost: draft.base_cost,
                  additional_cost: draft.additional_cost,
                }}
                productPhysical={{
                  weight: draft.weight,
                  length: draft.length,
                  width: draft.width,
                  height: draft.height,
                  weight_unit: draft.weight_unit,
                  dimension_unit: draft.dimension_unit,
                }}
              />
            </FormSection>
          </div>
        )}

        {isBundle && (
          <div className="rounded-md border border-border bg-card p-4">
            <FormSection
              title="Bundle Contents"
              description="The products or variants included in this bundle, with quantities."
            >
              <BundleContentsEditor
                value={draft.bundle_items}
                onChange={(b) => set("bundle_items", b)}
                {...(record?.id ? { currentProductId: record.id } : {})}
                disabled={readOnly}
              />
            </FormSection>
          </div>
        )}

        <div className="rounded-md border border-border bg-card p-4">
          <FormSection
            title="Related Products"
            description="Link related items, upsells and cross-sells. Order here controls display order."
          >
            <ProductRelationshipsEditor
              value={draft.relationships}
              onChange={(r) => set("relationships", r)}
              {...(record?.id ? { currentProductId: record.id } : {})}
              disabled={readOnly}
            />
          </FormSection>
        </div>

        {isGroupBuy && (
          <div className="rounded-md border border-border bg-card p-4">
            <FormSection
              title="Group Buy Campaigns"
              description="Each campaign collects orders over a window, then delivers around a planned date."
            >
              <GroupBuyCampaigns {...(record?.id ? { productId: record.id } : {})} />
            </FormSection>
          </div>
        )}
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
                onValueChange={(v) => setStatus(v as ProductStatus)}
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
            <div className="space-y-1">
              <div className="flex items-center justify-between rounded border border-border px-2.5 py-2">
                <Label htmlFor="purchasable" className="text-[12.5px]">
                  Purchasable
                </Label>
                <Switch
                  id="purchasable"
                  checked={draft.is_purchasable}
                  disabled={readOnly || draft.status === "archived"}
                  onCheckedChange={(v) => set("is_purchasable", v)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {draft.status === "archived"
                  ? "Archived products can never be purchasable."
                  : "Turn off for “coming soon”, temporarily unavailable or a seasonal pause."}
              </p>
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
                onValueChange={(v) => setProductType(v as ProductType)}
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
                  {SUPPLY_MODELS.map((s) => (
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
