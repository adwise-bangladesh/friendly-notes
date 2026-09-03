import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackagePlus, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getStore, getStoreChannels } from "@/lib/stores";
import { getCategories, getInternalProducts } from "@/lib/commerce";
import {
  activateStoreProduct,
  addProductToStore,
  archiveStoreProduct,
  getStoreCatalog,
  getStoreCatalogSummary,
} from "@/lib/store-catalog";
import {
  STORE_PRODUCT_STATUS_LABELS,
  STORE_PRODUCT_VISIBILITY_LABELS,
} from "@/types/store-catalog";
import type { StoreProductStatus, StoreProductVisibility } from "@/types/store-catalog";
import type { StatusTone } from "@/components/shared/StatusBadge";
import { formatMoney, parseMoney } from "@/lib/currency";

const TITLE = "Store catalog · Commerce Operations";
const DESCRIPTION = "Decide which products this store sells, at what price, and where they list.";

export const Route = createFileRoute("/_authenticated/stores_/$id/catalog")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const STATUS_TONE: Record<StoreProductStatus, StatusTone> = {
  draft: "neutral",
  active: "success",
  archived: "danger",
};

const PAGE_SIZE = 25;

function Page() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const perms = useCommercePermissions();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StoreProductStatus | "all">("all");
  const [visibility, setVisibility] = useState<StoreProductVisibility | "all">("all");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [channelId, setChannelId] = useState<string>("all");
  const [stock, setStock] = useState<"all" | "in_stock" | "out_of_stock">("all");
  const [page, setPage] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [addProductId, setAddProductId] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addSku, setAddSku] = useState("");

  const storeQuery = useQuery({ queryKey: ["store", id], queryFn: () => getStore(id) });
  const channelsQuery = useQuery({
    queryKey: ["store-channels", id],
    queryFn: () => getStoreChannels(id),
  });
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: () => getCategories({}) });
  const productsQuery = useQuery({
    queryKey: ["catalog-add-products"],
    queryFn: () => getInternalProducts({ status: "active", limit: 200 }),
    enabled: addOpen,
  });

  const filters = useMemo(
    () => ({
      search,
      status: status === "all" ? null : status,
      visibility: visibility === "all" ? null : visibility,
      categoryId: categoryId === "all" ? null : categoryId,
      channelId: channelId === "all" ? null : channelId,
      stock: stock === "all" ? null : stock,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [search, status, visibility, categoryId, channelId, stock, page],
  );

  const catalogQuery = useQuery({
    queryKey: ["store-catalog", id, filters],
    queryFn: () => getStoreCatalog(id, filters),
  });
  const summaryQuery = useQuery({
    queryKey: ["store-catalog-summary", id],
    queryFn: () => getStoreCatalogSummary(id),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["store-catalog", id] });
    void qc.invalidateQueries({ queryKey: ["store-catalog-summary", id] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      addProductToStore({
        storeId: id,
        productId: addProductId,
        sellingPrice: addPrice.trim() ? parseMoney(addPrice) : null,
        storeSku: addSku.trim() || null,
      }),
    onSuccess: () => {
      setAddOpen(false);
      setAddProductId("");
      setAddPrice("");
      setAddSku("");
      refresh();
      toast.success("Product added to this store");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not add this product."),
  });

  const activateMutation = useMutation({
    mutationFn: (storeProductId: string) => activateStoreProduct(storeProductId),
    onSuccess: () => {
      refresh();
      toast.success("Store product activated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Activation failed."),
  });

  const archiveMutation = useMutation({
    mutationFn: (storeProductId: string) => archiveStoreProduct(storeProductId),
    onSuccess: () => {
      refresh();
      toast.success("Store product archived");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Archive failed."),
  });

  const store = storeQuery.data;
  const rows = catalogQuery.data?.rows ?? [];
  const total = catalogQuery.data?.total ?? 0;
  const summary = summaryQuery.data;

  if (storeQuery.isLoading) return <LoadingState rows={4} label="Loading store catalog" />;
  if (!store) {
    return (
      <EmptyState
        icon={StoreIcon}
        title="Store not found"
        description="This store may have been removed."
        action={
          <Button size="sm" asChild>
            <Link to="/stores">Back to stores</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`${store.name} catalog`}
        description="Store products are selling decisions. Stock and product data stay in the master systems."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/stores/$id" params={{ id }}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Store
              </Link>
            </Button>
            {perms.canManage && store.status !== "archived" ? (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
                Add product
              </Button>
            ) : null}
          </div>
        }
      />

      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            ["Total", summary.total],
            ["Active", summary.active],
            ["Draft", summary.draft],
            ["Visible", summary.visible],
            ["Out of stock", summary.out_of_stock],
            ["Archived", summary.archived],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => {
            setPage(0);
            setSearch(event.target.value);
          }}
          placeholder="Search product, SKU or store SKU"
          className="h-8 w-64 text-[13px]"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setPage(0);
            setStatus(value as StoreProductStatus | "all");
          }}
        >
          <SelectTrigger className="h-8 w-36 text-[13px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STORE_PRODUCT_STATUS_LABELS) as StoreProductStatus[]).map((value) => (
              <SelectItem key={value} value={value}>
                {STORE_PRODUCT_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={visibility}
          onValueChange={(value) => {
            setPage(0);
            setVisibility(value as StoreProductVisibility | "all");
          }}
        >
          <SelectTrigger className="h-8 w-36 text-[13px]">
            <SelectValue placeholder="Visibility" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any visibility</SelectItem>
            {(Object.keys(STORE_PRODUCT_VISIBILITY_LABELS) as StoreProductVisibility[]).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {STORE_PRODUCT_VISIBILITY_LABELS[value]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <Select
          value={stock}
          onValueChange={(value) => {
            setPage(0);
            setStock(value as "all" | "in_stock" | "out_of_stock");
          }}
        >
          <SelectTrigger className="h-8 w-36 text-[13px]">
            <SelectValue placeholder="Stock" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any stock</SelectItem>
            <SelectItem value="in_stock">In stock</SelectItem>
            <SelectItem value="out_of_stock">Out of stock</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={categoryId}
          onValueChange={(value) => {
            setPage(0);
            setCategoryId(value);
          }}
        >
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(categoriesQuery.data ?? []).map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={channelId}
          onValueChange={(value) => {
            setPage(0);
            setChannelId(value);
          }}
        >
          <SelectTrigger className="h-8 w-44 text-[13px]">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any channel</SelectItem>
            {(channelsQuery.data ?? []).map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                {channel.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {catalogQuery.isLoading ? (
        <LoadingState rows={3} label="Loading catalog" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="No products in this catalog"
          description="Add a master product to start selling it from this store."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Store price</th>
                <th className="px-3 py-2 font-medium">Available</th>
                <th className="px-3 py-2 font-medium">Listings</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      to="/stores/$id/catalog/$storeProductId"
                      params={{ id, storeProductId: row.id }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {row.product_name}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {row.store_sku ?? row.master_sku ?? "No SKU"}
                      {row.is_purchasable ? "" : " · master product not purchasable"}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.category_name ?? "—"}</td>
                  <td className="px-3 py-2">{formatMoney(Number(row.selling_price))}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        Number(row.available_qty) > 0 ? "text-foreground" : "text-destructive"
                      }
                    >
                      {Number(row.available_qty)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.published_count}/{row.listing_count}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge tone={STATUS_TONE[row.status]}>
                        {STORE_PRODUCT_STATUS_LABELS[row.status]}
                      </StatusBadge>
                      <span className="text-[11px] text-muted-foreground">
                        {STORE_PRODUCT_VISIBILITY_LABELS[row.visibility]}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {perms.canManage && row.status === "draft" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={activateMutation.isPending}
                          onClick={() => activateMutation.mutate(row.id)}
                        >
                          Activate
                        </Button>
                      ) : null}
                      {perms.canArchive && row.status !== "archived" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={archiveMutation.isPending}
                          onClick={() => archiveMutation.mutate(row.id)}
                        >
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
        <span>
          {total === 0 ? "No results" : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + rows.length} of ${total}`}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a product to this store</DialogTitle>
            <DialogDescription>
              The master product stays unchanged. The store price defaults to the master price.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select value={addProductId} onValueChange={setAddProductId}>
                <SelectTrigger className="text-[13px]">
                  <SelectValue placeholder="Choose a product" />
                </SelectTrigger>
                <SelectContent>
                  {(productsQuery.data ?? []).map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Store price (optional)</Label>
              <Input
                value={addPrice}
                onChange={(event) => setAddPrice(event.target.value)}
                placeholder="Defaults to the master price"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Store SKU (optional)</Label>
              <Input value={addSku} onChange={(event) => setAddSku(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!addProductId || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              Add to store
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
