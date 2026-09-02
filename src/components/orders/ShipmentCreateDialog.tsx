import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { LoadingState } from "@/components/shared/LoadingState";
import { formatMoney } from "@/lib/currency";
import {
  createShipment,
  getCourierProviders,
  getFulfillmentShippableSummary,
} from "@/lib/shipping";
import { COURIER_SERVICE_TYPE_LABELS } from "@/types/shipping";
import type { CourierServiceType } from "@/types/shipping";

/**
 * Books an internal shipment for one packed fulfillment.
 *
 * Quantities offered here come from `fulfillment_shippable_summary` and are
 * re-validated inside `create_shipment`, so this dialog is an affordance and
 * never the authority. No courier API is contacted — the courier provider is
 * only recorded as an operational choice.
 */
export function ShipmentCreateDialog({
  fulfillmentId,
  orderId,
  suggestedCod,
  open,
  onOpenChange,
  onCreated,
}: {
  fulfillmentId: string;
  orderId: string;
  suggestedCod?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (shipmentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState("");
  const [serviceType, setServiceType] = useState<CourierServiceType | "">("");
  const [cod, setCod] = useState("");
  const [declaredValue, setDeclaredValue] = useState("");
  const [weight, setWeight] = useState("");
  const [packageCount, setPackageCount] = useState("1");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const { data: providers = [] } = useQuery({
    queryKey: ["courier-providers", "active"],
    queryFn: () => getCourierProviders(true),
    enabled: open,
  });

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["fulfillment-shippable", fulfillmentId],
    queryFn: () => getFulfillmentShippableSummary(fulfillmentId),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setQuantities(
      Object.fromEntries(lines.map((l) => [l.fulfillment_item_id, l.shippable])),
    );
    if (suggestedCod !== undefined) setCod(String(suggestedCod));
  }, [open, lines, suggestedCod]);

  const provider = providers.find((p) => p.id === providerId);
  const serviceOptions = provider?.service_types ?? [];

  const selected = useMemo(
    () =>
      lines
        .filter((l) => (quantities[l.fulfillment_item_id] ?? 0) > 0)
        .map((l) => ({
          fulfillmentItemId: l.fulfillment_item_id,
          quantity: quantities[l.fulfillment_item_id] ?? 0,
        })),
    [lines, quantities],
  );

  const nothingShippable = lines.every((l) => l.shippable <= 0);

  const mutation = useMutation({
    mutationFn: () =>
      createShipment({
        fulfillmentId,
        items: selected,
        providerId: providerId || null,
        serviceType: serviceType || null,
        cashOnDeliveryAmount: cod === "" ? null : Number(cod),
        declaredValue: declaredValue === "" ? null : Number(declaredValue),
        weight: weight === "" ? null : Number(weight),
        packageCount: packageCount === "" ? null : Number(packageCount),
        notes,
        internalNotes,
      }),
    onSuccess: (shipment) => {
      toast.success(`Shipment ${shipment.shipment_number} created`);
      queryClient.invalidateQueries({ queryKey: ["order-shipments", orderId] });
      queryClient.invalidateQueries({ queryKey: ["fulfillment-shipments", fulfillmentId] });
      queryClient.invalidateQueries({ queryKey: ["fulfillment-shippable", fulfillmentId] });
      queryClient.invalidateQueries({ queryKey: ["shipment-queue"] });
      onOpenChange(false);
      onCreated?.(shipment.id);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create shipment</DialogTitle>
          <DialogDescription>
            The delivery address and line items are frozen onto the shipment when it is created.
            Courier selection is recorded internally — no courier system is contacted.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <LoadingState rows={3} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Items to ship
              </p>
              {lines.map((line) => (
                <div
                  key={line.fulfillment_item_id}
                  className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{line.product_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[line.variant_name, line.sku].filter(Boolean).join(" · ") || "—"} · packed{" "}
                      {line.fulfilled} · shipped {line.shipped} · shippable {line.shippable}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={line.shippable}
                    value={quantities[line.fulfillment_item_id] ?? 0}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [line.fulfillment_item_id]: Math.max(
                          0,
                          Math.min(line.shippable, Number(e.target.value) || 0),
                        ),
                      }))
                    }
                    className="h-8 w-20 text-[13px]"
                    aria-label={`Quantity to ship for ${line.product_name}`}
                    disabled={line.shippable <= 0}
                  />
                </div>
              ))}
              {nothingShippable && (
                <p className="text-[12px] text-muted-foreground">
                  Everything packed in this fulfillment is already on a shipment.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Courier</label>
                <Select
                  value={providerId}
                  onValueChange={(v) => {
                    setProviderId(v);
                    setServiceType("");
                  }}
                >
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue placeholder="Decide later" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Service</label>
                <Select
                  value={serviceType}
                  onValueChange={(v) => setServiceType(v as CourierServiceType)}
                  disabled={!providerId}
                >
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {COURIER_SERVICE_TYPE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Cash to collect {suggestedCod !== undefined && `(due ${formatMoney(suggestedCod)})`}
                </label>
                <Input
                  type="number"
                  min={0}
                  value={cod}
                  onChange={(e) => setCod(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Declared value
                </label>
                <Input
                  type="number"
                  min={0}
                  value={declaredValue}
                  onChange={(e) => setDeclaredValue(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Weight (kg)</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Packages</label>
                <Input
                  type="number"
                  min={1}
                  value={packageCount}
                  onChange={(e) => setPackageCount(e.target.value)}
                  className="h-8 text-[13px]"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Courier instructions (shared with the delivery operation)"
                className="min-h-[64px] text-[13px]"
              />
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Internal note (never shared)"
                className="min-h-[64px] text-[13px]"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || selected.length === 0}
          >
            Create shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
