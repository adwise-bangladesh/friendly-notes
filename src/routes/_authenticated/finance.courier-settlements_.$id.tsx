import { useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, Plus, Trash2, Wand2 } from "lucide-react";
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
import { FormSection } from "@/components/commerce/FormSection";
import { SettlementDiscrepancies } from "@/components/finance/SettlementDiscrepancies";
import { formatMoney } from "@/lib/currency";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  addSettlementItem,
  getCourierSettlement,
  getSettleableShipments,
  recordSettlementActuals,
  removeSettlementItem,
  setSettlementStatus,
} from "@/lib/finance";
import {
  SETTLEMENT_STATUS_LABELS,
  SETTLEMENT_STATUS_TONE,
  isSettlementLocked,
} from "@/types/finance";
import type { SettlementItemWithContext } from "@/types/finance";

const TITLE = "Settlement Workspace · Commerce Operations";
const DESCRIPTION = "Reconcile one courier payout line by line against shipments and orders.";

export const Route = createFileRoute("/_authenticated/finance/courier-settlements_/$id")({
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

function Page() {
  const { id } = useParams({ from: "/_authenticated/finance/courier-settlements_/$id" });
  const queryClient = useQueryClient();
  const { canManage, canDelete: isAdmin } = useCommercePermissions();
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["courier-settlement", id],
    queryFn: () => getCourierSettlement(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["courier-settlement", id] });
    void queryClient.invalidateQueries({ queryKey: ["courier-settlements"] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: Parameters<typeof setSettlementStatus>[1]) =>
      setSettlementStatus(id, status),
    onSuccess: () => {
      invalidate();
      toast.success("Settlement updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => removeSettlementItem(itemId),
    onSuccess: () => {
      invalidate();
      toast.success("Line removed");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not remove"),
  });

  if (isLoading) return <LoadingState rows={6} label="Loading settlement" />;
  if (!data) {
    return (
      <EmptyState
        title="Settlement not found"
        description="It may have been removed, or you do not have access."
        action={
          <Button asChild size="sm" className="h-8">
            <Link to="/finance/courier-settlements">Back to settlements</Link>
          </Button>
        }
      />
    );
  }

  const { settlement, items } = data;
  const locked = isSettlementLocked(settlement.status);
  const actual = settlement.actual_amount === null ? null : Number(settlement.actual_amount);
  const expected = Number(settlement.expected_amount);
  const netPreview = items.reduce((sum, i) => sum + Number(i.net_settlement_amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title={settlement.settlement_reference}
        description={
          locked
            ? "This settlement is locked. Corrections are recorded as order financial adjustments."
            : "Attach shipments, record what the courier actually paid, then settle."
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="h-8">
              <Link to="/finance/courier-settlements">
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Settlements
              </Link>
            </Button>
            {canManage && !locked && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add shipment
              </Button>
            )}
            {isAdmin && !locked && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate("disputed")}
                >
                  Mark disputed
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate("settled")}
                >
                  Mark settled
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Courier">
          {settlement.provider_name ?? "—"}
          <div className="text-[11.5px] text-muted-foreground">{settlement.account?.name ?? "—"}</div>
        </Summary>
        <Summary label="Status">
          <StatusBadge tone={SETTLEMENT_STATUS_TONE[settlement.status]}>
            {SETTLEMENT_STATUS_LABELS[settlement.status]}
          </StatusBadge>
          <div className="text-[11.5px] text-muted-foreground">
            {settlement.settlement_date ?? "No settlement date"}
          </div>
        </Summary>
        <Summary label="Expected collection">
          <span className="tabular-nums">{formatMoney(expected)}</span>
        </Summary>
        <Summary label="Net settlement">
          <span className="tabular-nums">{formatMoney(actual ?? netPreview)}</span>
          <div className="text-[11.5px] text-muted-foreground">
            {actual === null ? "Calculated preview" : "Recorded"} · difference{" "}
            {formatMoney((actual ?? netPreview) - expected)}
          </div>
        </Summary>
      </div>

      <FormSection
        title="Settlement lines"
        description="Net = collected − delivery charge − COD charge − return charge − other charges."
      >
        {items.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No shipments attached yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Order</th>
                  <th className="px-2 py-1.5 text-left font-medium">Shipment</th>
                  <th className="px-2 py-1.5 text-right font-medium">Expected</th>
                  <th className="px-2 py-1.5 text-right font-medium">Collected</th>
                  <th className="px-2 py-1.5 text-right font-medium">Delivery</th>
                  <th className="px-2 py-1.5 text-right font-medium">COD fee</th>
                  <th className="px-2 py-1.5 text-right font-medium">Return</th>
                  <th className="px-2 py-1.5 text-right font-medium">Other</th>
                  <th className="px-2 py-1.5 text-right font-medium">Net</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <SettlementRow
                    key={item.id}
                    item={item}
                    locked={locked}
                    canManage={canManage}
                    onRemove={() => removeMutation.mutate(item.id)}
                    onSaved={invalidate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FormSection>

      <div className="mt-6">
        <FormSection
          title="Discrepancies"
          description="Where this payout differs from what the shipment actually collected."
        >
          <SettlementDiscrepancies
            settlementId={id}
            canManage={canManage}
            statusFilter={false}
          />
        </FormSection>
      </div>

      {canManage && !locked && settlement.account && (
        <AddShipmentDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          settlementId={id}
          courierAccountId={settlement.account.id}
          onAdded={invalidate}
        />
      )}
    </>
  );
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border p-2.5 text-[13px]">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function SettlementRow({
  item,
  locked,
  canManage,
  onRemove,
  onSaved,
}: {
  item: SettlementItemWithContext;
  locked: boolean;
  canManage: boolean;
  onRemove: () => void;
  onSaved: () => void;
}) {
  const [collected, setCollected] = useState(item.actual_collected_amount?.toString() ?? "");
  const [delivery, setDelivery] = useState(item.delivery_charge?.toString() ?? "");
  const [cod, setCod] = useState(item.cod_charge?.toString() ?? "");
  const [ret, setRet] = useState(item.return_charge?.toString() ?? "");
  const [other, setOther] = useState(item.other_charge?.toString() ?? "");

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const invalid = [collected, delivery, cod, ret, other].some((v) => {
    const n = num(v);
    return n !== null && (!Number.isFinite(n) || n < 0);
  });

  const save = useMutation({
    mutationFn: () =>
      recordSettlementActuals({
        itemId: item.id,
        actualCollectedAmount: num(collected),
        deliveryCharge: num(delivery),
        codCharge: num(cod),
        returnCharge: num(ret),
        otherCharge: num(other),
      }),
    onSuccess: () => {
      onSaved();
      toast.success("Actuals recorded");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not record"),
  });

  const cell = (value: string, set: (v: string) => void) => (
    <td className="px-1 py-1 text-right">
      {locked || !canManage ? (
        <span className="tabular-nums">{value === "" ? "—" : formatMoney(Number(value))}</span>
      ) : (
        <Input
          className="h-7 w-24 text-right text-[12.5px] tabular-nums"
          inputMode="decimal"
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </td>
  );

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-2 py-1.5">
        {item.order ? (
          <Link
            to="/orders/$id"
            params={{ id: item.order.id }}
            className="text-primary hover:underline"
          >
            {item.order.order_number}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-1.5 text-muted-foreground">{item.shipment?.shipment_number ?? "—"}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {formatMoney(Number(item.expected_collected_amount))}
      </td>
      {cell(collected, setCollected)}
      {cell(delivery, setDelivery)}
      {cell(cod, setCod)}
      {cell(ret, setRet)}
      {cell(other, setOther)}
      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
        {item.net_settlement_amount === null ? "—" : formatMoney(Number(item.net_settlement_amount))}
      </td>
      <td className="px-2 py-1.5 text-right">
        {canManage && !locked && (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={invalid || save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function AddShipmentDialog({
  open,
  onOpenChange,
  settlementId,
  courierAccountId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settlementId: string;
  courierAccountId: string;
  onAdded: () => void;
}) {
  const [shipmentId, setShipmentId] = useState("");
  const { data: shipments = [] } = useQuery({
    queryKey: ["settleable-shipments", courierAccountId],
    queryFn: () => getSettleableShipments(courierAccountId),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => addSettlementItem(settlementId, shipmentId),
    onSuccess: () => {
      onAdded();
      setShipmentId("");
      onOpenChange(false);
      toast.success("Shipment added");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Add shipment to settlement</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Only shipments this courier account has finished handling, and that are not already on
            another settlement.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-[12px]">Shipment</Label>
          <Select value={shipmentId} onValueChange={setShipmentId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a shipment" />
            </SelectTrigger>
            <SelectContent>
              {shipments.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.shipment_number} · COD {formatMoney(Number(s.cash_on_delivery_amount))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {shipments.length === 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              No unsettled shipments for this courier account.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!shipmentId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Add shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
