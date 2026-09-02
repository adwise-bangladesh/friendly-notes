import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Eye, EyeOff, Package, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { MediaImage } from "@/components/commerce/MediaImage";
import { getBrands } from "@/lib/commerce";
import {
  archiveProducts,
  displayPrice,
  listProducts,
  primaryMedia,
  setProductsStatus,
  setProductsVisibility,
} from "@/lib/products";
import { formatMoney } from "@/lib/currency";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  PRODUCT_STATUS_LABELS,
  PRODUCT_TYPE_LABELS,
  SUPPLY_MODELS,
  SUPPLY_MODEL_LABELS,
} from "@/types/commerce";
import type { ProductListRow, ProductStatus } from "@/types/commerce";
import type { StatusTone } from "@/components/shared/StatusBadge";

const STATUS_TONE: Record<ProductStatus, StatusTone> = {
  draft: "neutral",
  active: "success",
  inactive: "warning",
  archived: "danger",
};

export const Route = createFileRoute("/_authenticated/products/")({
  head: () => ({
    meta: [
      { title: "All Products · Commerce Operations" },
      {
        name: "description",
        content:
          "Browse, filter and bulk-manage your product catalog with pricing, media and variants.",
      },
      { property: "og:title", content: "All Products · Commerce Operations" },
      {
        property: "og:description",
        content: "Browse, filter and bulk-manage your product catalog.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const queryClient = useQueryClient();
  const { canManage, canArchive } = useCommercePermissions();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [brandId, setBrandId] = useState<string>("all");
  const [supply, setSupply] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmArchive, setConfirmArchive] = useState(false);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: listProducts,
  });
  const { data: brands = [] } = useQuery({ queryKey: ["brands"], queryFn: () => getBrands() });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (status === "all" && p.status === "archived") return false;
      if (brandId !== "all" && p.brand?.id !== brandId) return false;
      if (supply !== "all" && p.supply_model !== supply) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        p.slug.toLowerCase().includes(term) ||
        (p.sku ?? "").toLowerCase().includes(term) ||
        p.product_variants.some((v) => (v.sku ?? "").toLowerCase().includes(term))
      );
    });
  }, [products, search, status, brandId, supply]);

  const selectedIds = [...selected].filter((id) => rows.some((r) => r.id === id));
  const allChecked = rows.length > 0 && selectedIds.length === rows.length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    setSelected(new Set());
  };

  const bulk = useMutation({
    mutationFn: async (action: "activate" | "draft" | "show" | "hide" | "archive") => {
      if (action === "activate") return setProductsStatus(selectedIds, "active");
      if (action === "draft") return setProductsStatus(selectedIds, "draft");
      if (action === "show") return setProductsVisibility(selectedIds, "visible");
      if (action === "hide") return setProductsVisibility(selectedIds, "hidden");
      return archiveProducts(selectedIds);
    },
    onSuccess: () => {
      toast.success(`${selectedIds.length} product(s) updated`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Bulk action failed"),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtersActive =
    search.trim() !== "" || status !== "all" || brandId !== "all" || supply !== "all";

  return (
    <>
      <PageHeader
        title="All Products"
        description="Product catalog with pricing, media, categories and variants."
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link to="/products/new">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New Product
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, slug, product or variant SKU…"
            className="h-8 pl-7 text-[12.5px]"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[140px] text-[12.5px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Active statuses</SelectItem>
            {(["draft", "active", "inactive", "archived"] as ProductStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {PRODUCT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger className="h-8 w-[160px] text-[12.5px]">
            <SelectValue placeholder="Brand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={supply} onValueChange={setSupply}>
          <SelectTrigger className="h-8 w-[160px] text-[12.5px]">
            <SelectValue placeholder="Supply model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All supply models</SelectItem>
            {SUPPLY_MODELS.map((s) => (
              <SelectItem key={s} value={s}>
                {SUPPLY_MODEL_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setStatus("all");
              setBrandId("all");
              setSupply("all");
            }}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Bulk bar */}
      {selectedIds.length > 0 && canManage && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-[12.5px] font-medium">{selectedIds.length} selected</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => bulk.mutate("activate")}>
              Set Active
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate("draft")}>
              Set Draft
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate("show")}>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Show
            </Button>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate("hide")}>
              <EyeOff className="mr-1.5 h-3.5 w-3.5" />
              Hide
            </Button>
            {canArchive && (
              <Button size="sm" variant="outline" onClick={() => setConfirmArchive(true)}>
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                Archive
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {isLoading ? (
          <LoadingState rows={6} label="Loading products" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={filtersActive ? "No products match these filters" : "No products yet"}
            description={
              filtersActive
                ? "Try a different search term or clear the filters."
                : "Create your first product to start building the catalog."
            }
            action={
              !filtersActive && canManage ? (
                <Button asChild size="sm">
                  <Link to="/products/new">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    New Product
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {canManage && (
                    <th className="w-9 px-3 py-2">
                      <Checkbox
                        checked={allChecked}
                        aria-label="Select all"
                        onCheckedChange={(v) =>
                          setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())
                        }
                      />
                    </th>
                  )}
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Supply</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    canManage={canManage}
                    checked={selected.has(row.id)}
                    onToggle={() => toggle(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!isLoading && rows.length > 0 && (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {rows.length} product{rows.length === 1 ? "" : "s"}
        </p>
      )}

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${selectedIds.length} product(s)?`}
        description="Archived products are hidden from the default list and cannot be sold. You can restore them later by setting the status back."
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          setConfirmArchive(false);
          bulk.mutate("archive");
        }}
      />
    </>
  );
}

function Row({
  row,
  canManage,
  checked,
  onToggle,
}: {
  row: ProductListRow;
  canManage: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const primaryCategory =
    row.product_categories.find((c) => c.is_primary)?.category ??
    row.product_categories[0]?.category ??
    null;
  const price = displayPrice(row);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      {canManage && (
        <td className="px-3 py-2 align-middle">
          <Checkbox
            checked={checked}
            aria-label={`Select ${row.name}`}
            onCheckedChange={onToggle}
          />
        </td>
      )}
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <MediaImage
            path={primaryMedia(row.product_media ?? [])}
            alt={row.name}
            className="h-8 w-8 shrink-0"
          />
          <div className="min-w-0">
            <Link
              to="/products/$id"
              params={{ id: row.id }}
              className="block truncate font-medium text-foreground hover:text-primary hover:underline"
            >
              {row.name}
            </Link>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {row.sku ?? `/${row.slug}`}
            </span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{row.brand?.name ?? "—"}</td>
      <td className="px-3 py-2 text-muted-foreground">{primaryCategory?.name ?? "—"}</td>
      <td className="px-3 py-2 text-muted-foreground">
        {PRODUCT_TYPE_LABELS[row.product_type]}
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {SUPPLY_MODEL_LABELS[row.supply_model]}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {price === null ? (
          <span className="text-[11.5px] text-muted-foreground">Unpriced</span>
        ) : (
          <>
            {row.product_type === "variable" && (
              <span className="mr-1 text-[11px] text-muted-foreground">from</span>
            )}
            {formatMoney(price)}
            {row.compare_at_price && row.compare_at_price > price && (
              <span className="ml-1 text-[11px] text-muted-foreground line-through">
                {formatMoney(row.compare_at_price)}
              </span>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={STATUS_TONE[row.status]}>
            {PRODUCT_STATUS_LABELS[row.status]}
          </StatusBadge>
          {row.visibility === "hidden" && (
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" aria-label="Hidden" />
          )}
        </div>
      </td>
    </tr>
  );
}
