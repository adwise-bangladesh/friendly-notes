import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, PackageSearch, Plug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getStoreChannels } from "@/lib/stores";
import { getInternalProductById } from "@/lib/commerce";
import { formatMoney, parseMoney } from "@/lib/currency";
import {
  activateStoreProduct,
  archiveStoreProduct,
  getAvailableQuantity,
  getListingEvents,
  getStoreProduct,
  getStoreProductListings,
  getStoreProductPriceHistory,
  saveChannelListing,
  setChannelListingStatus,
  setStoreProductPrice,
  updateStoreProduct,
} from "@/lib/store-catalog";
import {
  CHANNEL_LISTING_EVENT_LABELS,
  CHANNEL_LISTING_STATUS_LABELS,
  STORE_PRODUCT_STATUS_LABELS,
  STORE_PRODUCT_VISIBILITY_LABELS,
} from "@/types/store-catalog";
import type {
  ChannelListingStatus,
  StoreProductStatus,
  StoreProductVisibility,
} from "@/types/store-catalog";
import type { StatusTone } from "@/components/shared/StatusBadge";

const TITLE = "Store product · Commerce Operations";
const DESCRIPTION = "Store pricing, presentation overrides and sales channel listings.";

export const Route = createFileRoute("/_authenticated/stores_/$id/catalog_/$storeProductId")({
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

const LISTING_TONE: Record<ChannelListingStatus, StatusTone> = {
  not_published: "neutral",
  publishing: "info",
  published: "success",
  sync_failed: "danger",
  archived: "warning",
};

function Page() {
  const { id, storeProductId } = Route.useParams();
  const qc = useQueryClient();
  const perms = useCommercePermissions();

  const spQuery = useQuery({
    queryKey: ["store-product", storeProductId],
    queryFn: () => getStoreProduct(storeProductId),
  });
  const storeProduct = spQuery.data;

  const productQuery = useQuery({
    queryKey: ["internal-product", storeProduct?.product_id],
    queryFn: () => getInternalProductById(storeProduct?.product_id ?? ""),
    enabled: Boolean(storeProduct?.product_id),
  });
  const availabilityQuery = useQuery({
    queryKey: ["store-product-availability", storeProduct?.product_id],
    queryFn: () => getAvailableQuantity(storeProduct?.product_id ?? ""),
    enabled: Boolean(storeProduct?.product_id),
  });
  const historyQuery = useQuery({
    queryKey: ["store-product-price-history", storeProductId],
    queryFn: () => getStoreProductPriceHistory(storeProductId),
  });
  const listingsQuery = useQuery({
    queryKey: ["store-product-listings", storeProductId],
    queryFn: () => getStoreProductListings(storeProductId),
  });
  const channelsQuery = useQuery({
    queryKey: ["store-channels", id],
    queryFn: () => getStoreChannels(id),
  });
  const listingIds = (listingsQuery.data ?? []).map((listing) => listing.id);
  const eventsQuery = useQuery({
    queryKey: ["listing-events", listingIds],
    queryFn: () => getListingEvents(listingIds),
    enabled: listingIds.length > 0,
  });

  const [priceInput, setPriceInput] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [storeSku, setStoreSku] = useState("");
  const [titleOverride, setTitleOverride] = useState("");
  const [descriptionOverride, setDescriptionOverride] = useState("");
  const [listingChannel, setListingChannel] = useState("");
  const [listingExternalId, setListingExternalId] = useState("");
  const [listingUrl, setListingUrl] = useState("");

  useEffect(() => {
    if (!storeProduct) return;
    setPriceInput(String(storeProduct.selling_price));
    setStoreSku(storeProduct.store_sku ?? "");
    setTitleOverride(storeProduct.title_override ?? "");
    setDescriptionOverride(storeProduct.description_override ?? "");
  }, [storeProduct]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["store-product", storeProductId] });
    void qc.invalidateQueries({ queryKey: ["store-product-price-history", storeProductId] });
    void qc.invalidateQueries({ queryKey: ["store-product-listings", storeProductId] });
    void qc.invalidateQueries({ queryKey: ["listing-events"] });
    void qc.invalidateQueries({ queryKey: ["store-catalog", id] });
    void qc.invalidateQueries({ queryKey: ["store-catalog-summary", id] });
  };

  const fail = (e: unknown, fallback: string) =>
    toast.error(e instanceof Error ? e.message : fallback);

  const detailsMutation = useMutation({
    mutationFn: (visibility?: StoreProductVisibility) =>
      updateStoreProduct(storeProductId, {
        store_sku: storeSku.trim() || null,
        title_override: titleOverride.trim() || null,
        description_override: descriptionOverride.trim() || null,
        ...(visibility ? { visibility } : {}),
      }),
    onSuccess: () => {
      refresh();
      toast.success("Store product updated");
    },
    onError: (e: unknown) => fail(e, "Update failed."),
  });

  const priceMutation = useMutation({
    mutationFn: () => {
      const price = parseMoney(priceInput);
      if (price === null) throw new Error("Enter a valid price.");
      return setStoreProductPrice(storeProductId, price, priceReason.trim() || null);
    },
    onSuccess: () => {
      setPriceReason("");
      refresh();
      toast.success("Store price updated");
    },
    onError: (e: unknown) => fail(e, "Price change failed."),
  });

  const activateMutation = useMutation({
    mutationFn: () => activateStoreProduct(storeProductId),
    onSuccess: () => {
      refresh();
      toast.success("Store product activated");
    },
    onError: (e: unknown) => fail(e, "Activation failed."),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveStoreProduct(storeProductId),
    onSuccess: () => {
      refresh();
      toast.success("Store product archived");
    },
    onError: (e: unknown) => fail(e, "Archive failed."),
  });

  const listingMutation = useMutation({
    mutationFn: () =>
      saveChannelListing({
        storeProductId,
        accountId: listingChannel,
        external_product_id: listingExternalId.trim() || null,
        external_url: listingUrl.trim() || null,
      }),
    onSuccess: () => {
      setListingExternalId("");
      setListingUrl("");
      refresh();
      toast.success("Channel listing saved");
    },
    onError: (e: unknown) => fail(e, "Could not save the listing."),
  });

  const listingStatusMutation = useMutation({
    mutationFn: (input: { listingId: string; status: ChannelListingStatus }) =>
      setChannelListingStatus(input.listingId, input.status),
    onSuccess: () => {
      refresh();
      toast.success("Listing status updated");
    },
    onError: (e: unknown) => fail(e, "Status change rejected."),
  });

  if (spQuery.isLoading) return <LoadingState rows={4} label="Loading store product" />;
  if (!storeProduct) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Store product not found"
        description="It may have been removed from this store."
        action={
          <Button size="sm" asChild>
            <Link to="/stores/$id/catalog" params={{ id }}>
              Back to catalog
            </Link>
          </Button>
        }
      />
    );
  }

  const archived = storeProduct.status === "archived";
  const externalChannels = (channelsQuery.data ?? []).filter(
    (channel) => channel.provider !== "manual",
  );

  return (
    <>
      <PageHeader
        title={productQuery.data?.name ?? "Store product"}
        description={`Master price ${formatMoney(productQuery.data?.price ?? null)} · available ${availabilityQuery.data ?? 0} (from inventory)`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/stores/$id/catalog" params={{ id }}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Catalog
              </Link>
            </Button>
            <StatusBadge tone={STATUS_TONE[storeProduct.status]}>
              {STORE_PRODUCT_STATUS_LABELS[storeProduct.status]}
            </StatusBadge>
            {perms.canManage && storeProduct.status === "draft" ? (
              <Button size="sm" onClick={() => activateMutation.mutate()}>
                Activate
              </Button>
            ) : null}
            {perms.canArchive && !archived ? (
              <Button size="sm" variant="ghost" onClick={() => archiveMutation.mutate()}>
                Archive
              </Button>
            ) : null}
          </div>
        }
      />

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Store settings</TabsTrigger>
          <TabsTrigger value="pricing">Pricing history</TabsTrigger>
          <TabsTrigger value="channels">Channel listings</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium">Presentation</h3>
              <div className="space-y-1.5">
                <Label>Store SKU</Label>
                <Input
                  value={storeSku}
                  disabled={archived || !perms.canManage}
                  onChange={(event) => setStoreSku(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Title override</Label>
                <Input
                  value={titleOverride}
                  disabled={archived || !perms.canManage}
                  onChange={(event) => setTitleOverride(event.target.value)}
                  placeholder={productQuery.data?.name ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description override</Label>
                <Textarea
                  value={descriptionOverride}
                  disabled={archived || !perms.canManage}
                  rows={4}
                  onChange={(event) => setDescriptionOverride(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={archived || !perms.canManage || detailsMutation.isPending}
                  onClick={() => detailsMutation.mutate(undefined)}
                >
                  Save
                </Button>
                <Select
                  value={storeProduct.visibility}
                  disabled={archived || !perms.canManage}
                  onValueChange={(value) =>
                    detailsMutation.mutate(value as StoreProductVisibility)
                  }
                >
                  <SelectTrigger className="h-8 w-36 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STORE_PRODUCT_VISIBILITY_LABELS) as StoreProductVisibility[]).map(
                      (value) => (
                        <SelectItem key={value} value={value}>
                          {STORE_PRODUCT_VISIBILITY_LABELS[value]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium">Store price</h3>
              <p className="text-[12px] text-muted-foreground">
                Current: {formatMoney(Number(storeProduct.selling_price))}
              </p>
              <div className="space-y-1.5">
                <Label>New price</Label>
                <Input
                  value={priceInput}
                  disabled={archived || !perms.canManage}
                  onChange={(event) => setPriceInput(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reason (optional)</Label>
                <Input
                  value={priceReason}
                  disabled={archived || !perms.canManage}
                  onChange={(event) => setPriceReason(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={archived || !perms.canManage || priceMutation.isPending}
                onClick={() => priceMutation.mutate()}
              >
                Update price
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pricing">
          {(historyQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="No price changes yet"
              description="Every store price change is recorded here permanently."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">From</th>
                    <th className="px-3 py-2 font-medium">To</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(historyQuery.data ?? []).map((entry) => (
                    <tr key={entry.id} className="border-t border-border">
                      <td className="px-3 py-2">{new Date(entry.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        {entry.previous_price === null
                          ? "—"
                          : formatMoney(Number(entry.previous_price))}
                      </td>
                      <td className="px-3 py-2">{formatMoney(Number(entry.new_price))}</td>
                      <td className="px-3 py-2 text-muted-foreground">{entry.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="channels" className="space-y-4">
          {perms.canArchive && !archived ? (
            <div className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select value={listingChannel} onValueChange={setListingChannel}>
                  <SelectTrigger className="text-[13px]">
                    <SelectValue placeholder="Choose channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {externalChannels.map((channel) => (
                      <SelectItem key={channel.id} value={channel.id}>
                        {channel.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>External product ID</Label>
                <Input
                  value={listingExternalId}
                  onChange={(event) => setListingExternalId(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>External URL</Label>
                <Input value={listingUrl} onChange={(event) => setListingUrl(event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button
                  size="sm"
                  disabled={!listingChannel || listingMutation.isPending}
                  onClick={() => listingMutation.mutate()}
                >
                  Save listing
                </Button>
              </div>
            </div>
          ) : null}

          {(listingsQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No channel listings"
              description="Map this store product to an external channel to track its publish state."
            />
          ) : (
            <div className="space-y-3">
              {(listingsQuery.data ?? []).map((listing) => {
                const channel = (channelsQuery.data ?? []).find(
                  (item) => item.id === listing.sales_channel_account_id,
                );
                return (
                  <div key={listing.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{channel?.name ?? "Channel"}</p>
                        <p className="text-[12px] text-muted-foreground">
                          {listing.external_product_id
                            ? `External ID ${listing.external_product_id}`
                            : "No external reference yet"}
                          {listing.last_sync_error ? ` · ${listing.last_sync_error}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={LISTING_TONE[listing.listing_status]}>
                          {CHANNEL_LISTING_STATUS_LABELS[listing.listing_status]}
                        </StatusBadge>
                        {perms.canArchive && listing.listing_status !== "archived" ? (
                          <Select
                            value={listing.listing_status}
                            onValueChange={(value) =>
                              listingStatusMutation.mutate({
                                listingId: listing.id,
                                status: value as ChannelListingStatus,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-40 text-[13px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                Object.keys(CHANNEL_LISTING_STATUS_LABELS) as ChannelListingStatus[]
                              ).map((value) => (
                                <SelectItem key={value} value={value}>
                                  {CHANNEL_LISTING_STATUS_LABELS[value]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(eventsQuery.data ?? []).length > 0 ? (
            <div className="rounded-lg border border-border p-4">
              <h3 className="mb-2 text-sm font-medium">Listing activity</h3>
              <ul className="space-y-1.5 text-[12px] text-muted-foreground">
                {(eventsQuery.data ?? []).map((event) => (
                  <li key={event.id}>
                    {new Date(event.created_at).toLocaleString()} ·{" "}
                    {CHANNEL_LISTING_EVENT_LABELS[event.event_type]}
                    {event.message ? ` · ${event.message}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </>
  );
}
