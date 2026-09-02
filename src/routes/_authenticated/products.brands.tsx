import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Tags,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { MediaImage } from "@/components/commerce/MediaImage";
import { BrandFormPanel, type BrandFormState } from "@/components/commerce/BrandFormPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { archiveBrand, getBrandProductCounts, getBrands, restoreBrand } from "@/lib/commerce";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  BRAND_TYPE_LABELS,
  ENTITY_STATUS_LABELS,
  type Brand,
  type BrandType,
  type EntityStatus,
} from "@/types/commerce";

export const Route = createFileRoute("/_authenticated/products/brands")({
  head: () => ({
    meta: [
      { title: "Brands · Commerce Operations" },
      {
        name: "description",
        content: "Manage the brands you sell, including own-brand and generic labels.",
      },
      { property: "og:title", content: "Brands · Commerce Operations" },
      {
        property: "og:description",
        content: "Create, edit and archive brand records linked to your catalog.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrandsPage,
});

const STATUS_TONE: Record<EntityStatus, StatusTone> = {
  active: "success",
  inactive: "neutral",
  archived: "warning",
};

function BrandsPage() {
  const qc = useQueryClient();
  const perms = useCommercePermissions();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EntityStatus>("active");
  const [typeFilter, setTypeFilter] = useState<"all" | BrandType>("all");
  const [formState, setFormState] = useState<BrandFormState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Brand | null>(null);

  const brandsQuery = useQuery({ queryKey: ["brands"], queryFn: () => getBrands() });
  const countsQuery = useQuery({ queryKey: ["brand-counts"], queryFn: getBrandProductCounts });

  const all = brandsQuery.data ?? [];
  const counts = countsQuery.data ?? {};

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (typeFilter !== "all" && b.brand_type !== typeFilter) return false;
      if (term && !b.name.toLowerCase().includes(term) && !b.slug.toLowerCase().includes(term))
        return false;
      return true;
    });
  }, [all, search, statusFilter, typeFilter]);

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveBrand(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["brands"] });
      toast.success("Brand archived");
      setArchiveTarget(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not archive brand"),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreBrand(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["brands"] });
      toast.success("Brand restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not restore brand"),
  });

  const error = brandsQuery.error ?? countsQuery.error;

  return (
    <>
      <PageHeader
        title="Brands"
        description="Manage the brands you sell, including own-brand and generic labels."
        actions={
          perms.canManage ? (
            <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Brand
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or slug"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="h-8 w-[130px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="h-8 w-[140px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="own_brand">Own Brand</SelectItem>
            <SelectItem value="generic">Generic</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {error instanceof Error ? error.message : "Failed to load brands."}
          </p>
        ) : brandsQuery.isLoading ? (
          <LoadingState rows={6} label="Loading brands" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={all.length === 0 ? "No brands yet" : "No matching brands"}
            description={
              all.length === 0
                ? "Add your first brand to start linking products to it."
                : "Try a different search term or adjust the filters."
            }
            action={
              all.length === 0 && perms.canManage ? (
                <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Brand
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Brand</th>
                  <th className="px-3 py-2 text-left font-semibold">Type</th>
                  <th className="px-3 py-2 text-right font-semibold">Products</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Visibility</th>
                  <th className="px-3 py-2 text-center font-semibold">Featured</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((brand) => (
                  <tr key={brand.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <MediaImage
                          path={brand.logo_url}
                          alt={brand.name}
                          className="h-7 w-7 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{brand.name}</div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            /{brand.slug}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                      {BRAND_TYPE_LABELS[brand.brand_type]}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {counts[brand.id] ?? 0}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={STATUS_TONE[brand.status]}>
                        {ENTITY_STATUS_LABELS[brand.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={brand.visibility === "visible" ? "info" : "neutral"}>
                        {brand.visibility === "visible" ? "Visible" : "Hidden"}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-1.5 text-center text-muted-foreground">
                      {brand.featured ? "★" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {(perms.canManage || perms.canArchive) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            {perms.canManage && (
                              <DropdownMenuItem
                                onSelect={() => setFormState({ mode: "edit", brand })}
                              >
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            {perms.canArchive &&
                              (brand.status === "archived" ? (
                                <DropdownMenuItem onSelect={() => restoreMutation.mutate(brand.id)}>
                                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                  Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => setArchiveTarget(brand)}>
                                  <Archive className="mr-2 h-3.5 w-3.5" />
                                  Archive
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BrandFormPanel state={formState} onClose={() => setFormState(null)} />

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name ?? "brand"}?`}
        description={
          archiveTarget && (counts[archiveTarget.id] ?? 0) > 0
            ? `This brand is linked to ${counts[archiveTarget.id]} products. Existing links stay intact, but the brand cannot be assigned to new products.`
            : "Archived brands are hidden from the default view and cannot be assigned to new products."
        }
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          if (archiveTarget) archiveMutation.mutate(archiveTarget.id);
        }}
      />
    </>
  );
}
