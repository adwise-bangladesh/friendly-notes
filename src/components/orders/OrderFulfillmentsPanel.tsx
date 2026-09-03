import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FormSection } from "@/components/commerce/FormSection";
import { getActiveLocations } from "@/lib/inventory";
import {
  createOrderFulfillment,
  getOrderFulfillmentSummary,
  getOrderFulfillmentEvents,
  getOrderFulfillments,
} from "@/lib/fulfillment-records";
import {
  FULFILLMENT_EVENT_LABELS,
  FULFILLMENT_RECORD_STATUS_LABELS,
  FULFILLMENT_RECORD_STATUS_TONE,
} from "@/types/fulfillment-records";
import type { OrderWithDetails } from "@/types/orders";

/**
 * Fulfillment overview for one order: ordered / fulfilled / remaining per line,
 * the list of fulfillments, and creation of the next one.
 *
 * Remaining quantities shown here come from the database
 * (`order_fulfillment_summary`) and are re-validated inside
 * `create_order_fulfillment`, so this panel is an affordance, not the authority.
 */
export function OrderFulfillmentsPanel({
  order,
  canManage,
}: {
  order: OrderWithDetails;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: fulfillments = [], isPending: fulfillmentsPending } = useQuery({
    queryKey: ["order-fulfillments", order.id],
    queryFn: () => getOrderFulfillments(order.id),
  });
  const { data: summary, isPending: summaryPending } = useQuery({
    queryKey: ["order-fulfillment-summary", order.id],
    queryFn: () => getOrderFulfillmentSummary(order.id),
  });
  const { data: timeline = [] } = useQuery({
    queryKey: ["order-fulfillment-events", order.id],
    queryFn: () => getOrderFulfillmentEvents(order.id),
  });
  const { data: locations = [] } = useQuery({
    queryKey: ["inventory-locations", "active"],
    queryFn: () => getActiveLocations(),
  });

  const eligible =
    order.status !== "cancelled" &&
    (order.verification_status === "confirmed" || order.verification_status === "not_required");

  const remainingLines = useMemo(
    () =>
      order.items
        .map((item) => ({
          item,
          remaining: summary?.get(item.id)?.remaining ?? item.quantity,
        }))
        .filter((line) => line.remaining > 0),
    [order.items, summary],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      createOrderFulfillment({
        orderId: order.id,
        locationId,
        notes,
        items: remainingLines
          .map((line) => ({
            orderItemId: line.item.id,
            quantity: quantities[line.item.id] ?? line.remaining,
          }))
          .filter((line) => line.quantity > 0),
      }),
    onSuccess: () => {
      setOpen(false);
      setNotes("");
      setQuantities({});
      void queryClient.invalidateQueries({ queryKey: ["order-fulfillments", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["order-fulfillment-summary", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["order-fulfillment-events", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      void queryClient.invalidateQueries({ queryKey: ["fulfillment-record-queue"] });
      toast.success("Fulfillment created");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not create the fulfillment"),
  });

  const openDialog = () => {
    setLocationId(locations.find((l) => l.is_default)?.id ?? locations[0]?.id ?? "");
    setQuantities(
      Object.fromEntries(remainingLines.map((line) => [line.item.id, line.remaining])),
    );
    setOpen(true);
  };

  return (
    <FormSection
      title="Warehouse fulfillment"
      description={
        eligible
          ? "Fulfillments are warehouse packing jobs. An order can have several."
          : "Fulfillment starts once the order is not cancelled and verification is confirmed."
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Product</th>
              <th className="py-1.5 px-2 text-right font-medium">Ordered</th>
              <th className="py-1.5 px-2 text-right font-medium">Fulfilled</th>
              <th className="py-1.5 pl-2 text-right font-medium">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => {
              const line = summary?.get(item.id);
              return (
                <tr key={item.id} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-2">
                    {item.product_name}
                    {item.variant_name && (
                      <span className="text-muted-foreground"> · {item.variant_name}</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {summaryPending ? "…" : (line?.fulfilled ?? 0)}
                  </td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    {summaryPending ? "…" : (line?.remaining ?? item.quantity)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-1.5">
        {fulfillmentsPending ? (
          <p className="text-[12.5px] text-muted-foreground">Loading fulfillments…</p>
        ) : fulfillments.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No fulfillment has been created yet.</p>
        ) : (
          fulfillments.map((f) => (
            <Link
              key={f.id}
              to="/orders/fulfillments/$id"
              params={{ id: f.id }}
              className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1.5 text-[12.5px] hover:bg-muted/50"
            >
              <span className="font-medium">Fulfillment #{f.fulfillment_number}</span>
              <StatusBadge tone={FULFILLMENT_RECORD_STATUS_TONE[f.status]}>
                {FULFILLMENT_RECORD_STATUS_LABELS[f.status]}
              </StatusBadge>
              <span className="text-muted-foreground">{f.location?.name ?? "No warehouse"}</span>
              <span className="text-muted-foreground">{f.items.length} line(s)</span>
              <span className="ml-auto text-[11.5px] text-muted-foreground">
                {new Date(f.updated_at).toLocaleString()}
              </span>
            </Link>
          ))
        )}
      </div>

      {timeline.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Fulfillment timeline
          </p>
          <ol className="space-y-1">
            {timeline.map((event) => (
              <li key={event.id} className="border-l-2 border-border pl-2 text-[12px]">
                <span className="font-medium">
                  Fulfillment #{event.fulfillment?.fulfillment_number ?? "?"} ·{" "}
                  {FULFILLMENT_EVENT_LABELS[event.event_type]}
                </span>
                <span className="block text-muted-foreground">
                  {event.message} · {new Date(event.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}


      {canManage && eligible && remainingLines.length > 0 && (
        <Button size="sm" variant="outline" className="h-8" onClick={openDialog}>
          <PackagePlus className="mr-1 h-3.5 w-3.5" /> Create fulfillment
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create fulfillment</DialogTitle>
            <DialogDescription>
              Remaining quantities are preselected. Reduce them for a partial fulfillment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Warehouse
              </label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="h-8 text-[13px]" aria-label="Warehouse location">
                  <SelectValue placeholder="Select a warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} · {l.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              {remainingLines.map(({ item, remaining }) => (
                <div key={item.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-[12.5px]">
                    {item.product_name}
                    {item.variant_name && (
                      <span className="text-muted-foreground"> · {item.variant_name}</span>
                    )}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">of {remaining}</span>
                  <Input
                    type="number"
                    min={0}
                    max={remaining}
                    value={quantities[item.id] ?? remaining}
                    onChange={(e) =>
                      setQuantities((q) => ({
                        ...q,
                        [item.id]: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)),
                      }))
                    }
                    className="h-8 w-20 text-[13px]"
                    aria-label={`Quantity for ${item.product_name}`}
                  />
                </div>
              ))}
            </div>

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Operational notes (optional)"
              className="min-h-16 text-[13px]"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!locationId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create fulfillment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormSection>
  );
}
