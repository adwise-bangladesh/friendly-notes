import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCourierAccounts, getCourierProviders } from "@/lib/shipping";
import { bulkAssignShipmentCourier, bookingBlockReason } from "@/lib/shipping-console";
import type { ShipmentConsoleRow, BulkAssignResult } from "@/lib/shipping-console";
import { invalidateShippingSurfaces } from "@/lib/shipping-cache";
import { bookShipmentWithCourier } from "@/lib/couriers.functions";
import { COURIER_SERVICE_TYPES, COURIER_SERVICE_TYPE_LABELS } from "@/types/shipping";
import type { CourierServiceType } from "@/types/shipping";

const MAX_BULK = 100;
const MAX_BULK_BOOK = 25;

interface Outcome {
  label: string;
  ok: boolean;
  message: string;
}

/**
 * Bulk courier assignment and bulk booking. Both reuse the authoritative
 * per-shipment workflows (`assign_shipment_courier` inside
 * `bulk_assign_shipment_courier`, and `bookShipmentWithCourier` /
 * `book_shipment_begin` one shipment at a time), so every guard still runs and
 * partial success is reported per shipment instead of being hidden.
 */
export function ShipmentBulkActions({
  mode,
  rows,
  onOpenChange,
}: {
  mode: "assign" | "book";
  rows: ShipmentConsoleRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("auto");
  const [serviceType, setServiceType] = useState<CourierServiceType | "keep">("keep");
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);

  const { data: providers = [] } = useQuery({
    queryKey: ["courier-providers"],
    queryFn: () => getCourierProviders(),
    enabled: mode === "assign",
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["courier-accounts", providerId],
    queryFn: () => getCourierAccounts(providerId),
    enabled: mode === "assign" && !!providerId,
  });

  const bookFn = useServerFn(bookShipmentWithCourier);

  const eligible =
    mode === "assign"
      ? rows.filter((row) => !row.external_consignment_id)
      : rows.filter((row) => bookingBlockReason(row) === null);
  const skipped = rows.length - eligible.length;
  const capped = eligible.slice(0, mode === "assign" ? MAX_BULK : MAX_BULK_BOOK);

  async function runAssign() {
    if (!providerId) return;
    setRunning(true);
    try {
      const result: BulkAssignResult = await bulkAssignShipmentCourier({
        shipmentIds: capped.map((row) => row.id),
        providerId,
        ...(serviceType === "keep" ? {} : { serviceType }),
        ...(accountId === "auto" ? {} : { accountId }),
      });
      setOutcomes(
        result.results.map((item) => ({
          label: item.shipment_number ?? item.shipment_id,
          ok: item.ok,
          message: item.ok ? "Courier assigned" : (item.error ?? "Failed"),
        })),
      );
      toast[result.failed > 0 ? "warning" : "success"](
        `${result.succeeded} assigned, ${result.failed} failed.`,
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRunning(false);
      invalidateShippingSurfaces(queryClient);
    }
  }

  async function runBook() {
    setRunning(true);
    const results: Outcome[] = [];
    for (const row of capped) {
      try {
        const result = await bookFn({ data: { shipmentId: row.id } });
        results.push({ label: row.shipment_number, ok: result.ok, message: result.message });
      } catch (error) {
        results.push({ label: row.shipment_number, ok: false, message: (error as Error).message });
      }
      setOutcomes([...results]);
    }
    setRunning(false);
    invalidateShippingSurfaces(queryClient);
    const failed = results.filter((r) => !r.ok).length;
    toast[failed > 0 ? "warning" : "success"](
      `${results.length - failed} booked, ${failed} need attention.`,
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "assign" ? "Assign courier" : "Book shipments with courier"}
          </DialogTitle>
          <DialogDescription>
            {capped.length} of {rows.length} selected shipment(s) can proceed.
            {skipped > 0 ? ` ${skipped} skipped because the action is not allowed for them.` : ""}
            {eligible.length > capped.length
              ? ` Only the first ${capped.length} will be processed.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {mode === "assign" && (
          <div className="space-y-2">
            <Select
              value={providerId}
              onValueChange={(value) => {
                setProviderId(value);
                setAccountId("auto");
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select courier provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={accountId} onValueChange={setAccountId} disabled={!providerId}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Resolve account automatically</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={serviceType}
              onValueChange={(value) => setServiceType(value as CourierServiceType | "keep")}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Keep current service type</SelectItem>
                {COURIER_SERVICE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {COURIER_SERVICE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {mode === "book" && (
          <p className="text-[12.5px] text-muted-foreground">
            Each shipment is booked one at a time through the courier workflow. Shipments whose
            outcome is unknown are never retried automatically.
          </p>
        )}

        {outcomes && (
          <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-border p-2">
            {outcomes.map((item, index) => (
              <p
                key={`${item.label}-${index}`}
                className={`text-[12px] ${item.ok ? "text-muted-foreground" : "text-destructive"}`}
              >
                {item.label}: {item.message}
              </p>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {outcomes ? "Close" : "Cancel"}
          </Button>
          <Button
            disabled={
              running || capped.length === 0 || (mode === "assign" && !providerId) || !!outcomes
            }
            onClick={() => void (mode === "assign" ? runAssign() : runBook())}
          >
            {running
              ? "Working…"
              : mode === "assign"
                ? `Assign ${capped.length}`
                : `Book ${capped.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
