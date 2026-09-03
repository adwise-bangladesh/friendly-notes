/**
 * Channel listings workspace — every listing this store has on external
 * channels, with its publish state and sync health. Read-only overview:
 * operations happen on the store product detail page where readiness is shown.
 */

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { getStore, getStoreChannels } from "@/lib/stores";
import { getStoreChannelListings } from "@/lib/store-catalog";
import { formatMoney } from "@/lib/currency";
import { CHANNEL_LISTING_STATUS_LABELS } from "@/types/store-catalog";
import type { ChannelListingStatus } from "@/types/store-catalog";
import type { StatusTone } from "@/components/shared/StatusBadge";

const TITLE = "Channel listings · Commerce Operations";
const DESCRIPTION = "Publish state and synchronisation health for every external channel listing.";

export const Route = createFileRoute("/_authenticated/stores_/$id/catalog_/listings")({
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

const TONE: Record<ChannelListingStatus, StatusTone> = {
  not_published: "neutral",
  ready: "info",
  publishing: "info",
  published: "success",
  update_pending: "warning",
  syncing: "info",
  sync_failed: "danger",
  paused: "warning",
  archived: "warning",
};

const PAGE_SIZE = 25;

function Page() {
  const { id } = Route.useParams();
  const [search, setSearch] = useState("");
  const [channelId, setChannelId] = useState("all");
  const [status, setStatus] = useState<ChannelListingStatus | "all">("all");
  const [health, setHealth] = useState<"all" | "healthy" | "failing" | "never_synced">("all");
  const [page, setPage] = useState(0);

  const storeQuery = useQuery({ queryKey: ["store", id], queryFn: () => getStore(id) });
  const channelsQuery = useQuery({
    queryKey: ["store-channels", id],
    queryFn: () => getStoreChannels(id),
  });
  const listingsQuery = useQuery({
    queryKey: ["store-listings", id, search, channelId, status, health, page],
    queryFn: () =>
      getStoreChannelListings(id, {
        search,
        channelId: channelId === "all" ? null : channelId,
        status: status === "all" ? null : status,
        health: health === "all" ? null : health,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const rows = listingsQuery.data?.rows ?? [];
  const total = listingsQuery.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Channel listings"
        description={storeQuery.data ? `${storeQuery.data.name} · external publish state` : "Store"}
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/stores/$id/catalog" params={{ id }}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Catalog
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/stores/$id/catalog/sync" params={{ id }}>
                Sync queue
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <Input
          placeholder="Search product or SKU"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          className="text-[13px]"
        />
        <Select
          value={channelId}
          onValueChange={(value) => {
            setChannelId(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="text-[13px]">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {(channelsQuery.data ?? []).map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                {channel.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as ChannelListingStatus | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="text-[13px]">
            <SelectValue placeholder="Listing status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(CHANNEL_LISTING_STATUS_LABELS) as ChannelListingStatus[]).map((value) => (
              <SelectItem key={value} value={value}>
                {CHANNEL_LISTING_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={health}
          onValueChange={(value) => {
            setHealth(value as typeof health);
            setPage(0);
          }}
        >
          <SelectTrigger className="text-[13px]">
            <SelectValue placeholder="Sync health" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any sync health</SelectItem>
            <SelectItem value="healthy">No sync error</SelectItem>
            <SelectItem value="failing">Sync failing</SelectItem>
            <SelectItem value="never_synced">Never synced</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {listingsQuery.isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No channel listings"
          description="Map a store product to an external channel from the catalog to publish it."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Listing</th>
                  <th className="px-3 py-2 font-medium">External</th>
                  <th className="px-3 py-2 font-medium text-right">Price</th>
                  <th className="px-3 py-2 font-medium text-right">Available</th>
                  <th className="px-3 py-2 font-medium">Last sync</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <Link
                        to="/stores/$id/catalog/$storeProductId"
                        params={{ id, storeProductId: row.store_product_id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.product_name}
                      </Link>
                      <div className="text-[12px] text-muted-foreground">{row.store_sku ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2">
                      {row.channel_name}
                      <div className="text-[12px] text-muted-foreground">
                        {row.provider} · {row.channel_status}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={TONE[row.listing_status]}>
                        {CHANNEL_LISTING_STATUS_LABELS[row.listing_status]}
                      </StatusBadge>
                      {row.last_sync_error ? (
                        <div className="mt-1 text-[12px] text-destructive">{row.last_sync_error}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {row.external_product_id ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">{formatMoney(Number(row.selling_price))}</td>
                    <td className="px-3 py-2 text-right">{Number(row.available_qty)}</td>
                    <td className="px-3 py-2 text-[12px] text-muted-foreground">
                      {row.last_synced_at ? new Date(row.last_synced_at).toLocaleString() : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              {rows.length} of {total} listings
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
        </>
      )}
    </>
  );
}
