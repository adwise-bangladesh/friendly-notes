import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMoney } from "@/lib/currency";
import { getItemCostHistory } from "@/lib/procurement";
import { COST_SOURCE_LABELS, COST_TYPE_LABELS } from "@/types/procurement";
import { History } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  productId: string | null;
  variantId: string | null;
}

/**
 * Cost history is an audit trail: a row is written only when someone
 * explicitly changes the catalog cost. Receiving goods never rewrites cost
 * silently.
 */
export function CostHistoryDialog({ open, onOpenChange, title, productId, variantId }: Props) {
  const historyQuery = useQuery({
    queryKey: ["cost-history", productId, variantId],
    queryFn: () => getItemCostHistory({ productId, variantId }),
    enabled: open && (productId !== null || variantId !== null),
  });

  const rows = historyQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Cost history</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        {historyQuery.isLoading ? (
          <LoadingState rows={3} label="Loading cost history" />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={History}
            title="No recorded cost changes"
            description="Cost history records every deliberate change to this item's cost."
          />
        ) : (
          <ul className="divide-y divide-border text-[13px]">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{COST_TYPE_LABELS[row.cost_type]}</span>
                    <StatusBadge tone={row.source_type === "correction" ? "warning" : "neutral"}>
                      {COST_SOURCE_LABELS[row.source_type]}
                    </StatusBadge>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {new Date(row.effective_at).toLocaleString()}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <span className="text-muted-foreground line-through">
                    {formatMoney(row.previous_cost)}
                  </span>
                  <span className="ml-2 font-medium">{formatMoney(row.new_cost)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
