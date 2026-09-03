import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import { getProductStoreAssignments } from "@/lib/store-catalog";
import {
  STORE_PRODUCT_STATUS_LABELS,
  STORE_PRODUCT_VISIBILITY_LABELS,
} from "@/types/store-catalog";
import type { StoreProductStatus } from "@/types/store-catalog";
import type { StatusTone } from "@/components/shared/StatusBadge";

const TONE: Record<StoreProductStatus, StatusTone> = {
  draft: "neutral",
  active: "success",
  archived: "danger",
};

/** Read-only view of which stores currently sell this master product. */
export function ProductStoreAssignments({ productId }: { productId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["product-store-assignments", productId],
    queryFn: () => getProductStoreAssignments(productId),
  });

  if (isLoading) return null;
  const rows = data ?? [];

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium">Selling in stores</h3>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Store pricing and visibility are managed inside each store catalog.
      </p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          This product is not in any store catalog yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[13px] first:border-0 first:pt-0"
            >
              <Link
                to="/stores/$id/catalog/$storeProductId"
                params={{ id: row.store_id, storeProductId: row.id }}
                className="font-medium hover:underline"
              >
                {row.store_name}
              </Link>
              <span className="text-muted-foreground">
                {formatMoney(Number(row.selling_price))} · {Number(row.available_qty)} available ·{" "}
                {row.listing_count} listing{row.listing_count === 1 ? "" : "s"}
              </span>
              <span className="flex items-center gap-1.5">
                <StatusBadge tone={TONE[row.status]}>
                  {STORE_PRODUCT_STATUS_LABELS[row.status]}
                </StatusBadge>
                <span className="text-[11px] text-muted-foreground">
                  {STORE_PRODUCT_VISIBILITY_LABELS[row.visibility]}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
