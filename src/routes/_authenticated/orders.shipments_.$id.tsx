import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormSection } from "@/components/commerce/FormSection";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import {
  assignShipmentCourier,
  getCourierAccounts,
  getCourierProviders,
  getShipmentCourierEvents,
  getShipmentById,
  getShipmentEvents,
  resolveUnknownCourierBooking,
  setShipmentState,
  updateShipmentDetails,
} from "@/lib/shipping";
import {
  bookShipmentWithCourier,
  cancelShipmentWithCourier,
  quoteShipmentDeliveryFee,
  refreshShipmentCourierStatus,
} from "@/lib/couriers.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  COURIER_SERVICE_TYPE_LABELS,
  FAILURE_REASON_ACTIONS,
  FREE_TEXT_REASON_ACTIONS,
  HOLD_REASON_ACTIONS,
  SHIPMENT_ACTION_LABELS,
  SHIPMENT_EVENT_LABELS,
  SHIPMENT_FAILURE_REASONS,
  SHIPMENT_FAILURE_REASON_LABELS,
  SHIPMENT_HOLD_REASONS,
  SHIPMENT_HOLD_REASON_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_MEANINGS,
  SHIPMENT_STATUS_TONE,
  availableShipmentActions,
} from "@/types/shipping";
import type {
  CourierServiceType,
  ShipmentAction,
  ShipmentFailureReason,
  ShipmentHoldReason,
} from "@/types/shipping";

const TITLE = "Shipment Workspace · Commerce Operations";
const DESCRIPTION = "Track and update one internal shipment through its courier lifecycle.";

export const Route = createFileRoute("/_authenticated/orders/shipments_/$id")({
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
  const { id } = useParams({ from: "/_authenticated/orders/shipments_/$id" });
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();

  const [action, setAction] = useState<ShipmentAction | null>(null);
  const [reason, setReason] = useState("");
  // unknown-booking recovery inputs
  const [recoveryConsignment, setRecoveryConsignment] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [holdReason, setHoldReason] = useState<ShipmentHoldReason | "">("");
  const [failureReason, setFailureReason] = useState<ShipmentFailureReason | "">("");
  const [tracking, setTracking] = useState("");
  const [consignment, setConsignment] = useState("");

  const [providerId, setProviderId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [serviceType, setServiceType] = useState<CourierServiceType | "">("");
  const [cod, setCod] = useState("");
  const [declaredValue, setDeclaredValue] = useState("");
  const [weight, setWeight] = useState("");
  const [packageCount, setPackageCount] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const { data: shipment, isLoading } = useQuery({
    queryKey: ["shipment", id],
    queryFn: () => getShipmentById(id),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["shipment-events", id],
    queryFn: () => getShipmentEvents(id),
  });

  const { data: providers = [] } = useQuery({
    queryKey: ["courier-providers", "active"],
    queryFn: () => getCourierProviders(true),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["courier-accounts", providerId],
    queryFn: () => getCourierAccounts(providerId),
    enabled: Boolean(providerId),
  });

  const { data: courierEvents = [] } = useQuery({
    queryKey: ["shipment-courier-events", id],
    queryFn: () => getShipmentCourierEvents(id),
  });

  useEffect(() => {
    if (!shipment) return;
    setProviderId(shipment.provider_id ?? "");
    setAccountId(shipment.courier_account_id ?? "");
    setServiceType(shipment.service_type ?? "");
    setCod(String(shipment.cash_on_delivery_amount ?? 0));
    setDeclaredValue(shipment.declared_value == null ? "" : String(shipment.declared_value));
    setWeight(shipment.weight == null ? "" : String(shipment.weight));
    setPackageCount(String(shipment.package_count ?? 1));
    setNotes(shipment.notes ?? "");
    setInternalNotes(shipment.internal_notes ?? "");
  }, [shipment]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["shipment", id] });
    queryClient.invalidateQueries({ queryKey: ["shipment-events", id] });
    queryClient.invalidateQueries({ queryKey: ["shipment-queue"] });
    queryClient.invalidateQueries({ queryKey: ["shipment-courier-events", id] });
    if (shipment?.order_id) {
      queryClient.invalidateQueries({ queryKey: ["order-shipments", shipment.order_id] });
    }
  };

  const stateMutation = useMutation({
    mutationFn: (act: ShipmentAction) =>
      setShipmentState({
        shipmentId: id,
        action: act,
        reason,
        holdReason: holdReason || null,
        failureReason: failureReason || null,
        trackingNumber: tracking,
        externalConsignmentId: consignment,
      }),
    onSuccess: () => {
      toast.success("Shipment updated");
      setAction(null);
      setReason("");
      setHoldReason("");
      setFailureReason("");
      setTracking("");
      setConsignment("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const courierMutation = useMutation({
    mutationFn: () =>
      assignShipmentCourier({
        shipmentId: id,
        providerId,
        serviceType: serviceType || null,
        accountId: accountId || null,
      }),
    onSuccess: () => {
      toast.success("Courier assigned");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bookFn = useServerFn(bookShipmentWithCourier);
  const refreshFn = useServerFn(refreshShipmentCourierStatus);
  const quoteFn = useServerFn(quoteShipmentDeliveryFee);

  /**
   * Courier API actions. Each one is safe to press twice: booking claims the
   * attempt under a row lock before the courier is contacted, so a second press
   * is answered locally; status refresh runs through the same idempotent
   * ingestion path as a webhook.
   */
  const apiMutation = useMutation({
    mutationFn: async (kind: "book" | "refresh" | "quote") => {
      if (kind === "book") return bookFn({ data: { shipmentId: id } });
      if (kind === "refresh") return refreshFn({ data: { shipmentId: id } });
      return quoteFn({ data: { shipmentId: id } });
    },
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancelWithCourierFn = useServerFn(cancelShipmentWithCourier);
  const cancelCourierMutation = useMutation({
    mutationFn: () => cancelWithCourierFn({ data: { shipmentId: id, reason } }),
    onSuccess: (result) => {
      toast.success(result.message);
      setReason("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** Operator recovery when a booking attempt ended with an unknown outcome. */
  const recoveryMutation = useMutation({
    mutationFn: (resolution: "confirm" | "abandon") =>
      resolveUnknownCourierBooking({
        shipmentId: id,
        resolution,
        consignmentId: recoveryConsignment,
        reason: recoveryReason,
      }),
    onSuccess: () => {
      toast.success("Booking outcome resolved");
      setRecoveryConsignment("");
      setRecoveryReason("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const detailsMutation = useMutation({
    mutationFn: () =>
      updateShipmentDetails({
        shipmentId: id,
        cashOnDeliveryAmount: cod === "" ? null : Number(cod),
        declaredValue: declaredValue === "" ? null : Number(declaredValue),
        weight: weight === "" ? null : Number(weight),
        packageCount: packageCount === "" ? null : Number(packageCount),
        notes,
        internalNotes,
      }),
    onSuccess: () => {
      toast.success("Shipment details saved");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <LoadingState rows={8} />;
  if (!shipment) {
    return <EmptyState title="Shipment not found" description="It may have been removed." />;
  }

  const actions = availableShipmentActions(shipment.status);
  const provider = providers.find((p) => p.id === providerId);
  const serviceOptions = provider?.service_types ?? [];
  const needsHold = action ? HOLD_REASON_ACTIONS.includes(action) : false;
  const needsFailure = action ? FAILURE_REASON_ACTIONS.includes(action) : false;
  const needsText = action ? FREE_TEXT_REASON_ACTIONS.includes(action) : false;
  const isBooking = action === "confirm_booking";
  const confirmDisabled =
    (needsHold && !holdReason) ||
    (needsFailure && !failureReason) ||
    (needsText && !reason.trim()) ||
    stateMutation.isPending;

  return (
    <>
      <div className="mb-2">
        <Link
          to="/orders/shipments"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Shipping desk
        </Link>
      </div>

      <PageHeader
        title={shipment.shipment_number}
        description={SHIPMENT_STATUS_MEANINGS[shipment.status]}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={SHIPMENT_STATUS_TONE[shipment.status]}>
          {SHIPMENT_STATUS_LABELS[shipment.status]}
        </StatusBadge>
        {shipment.order && (
          <Link
            to="/orders/$id"
            params={{ id: shipment.order.id }}
            className="text-[12px] text-primary hover:underline"
          >
            Order {shipment.order.order_number}
          </Link>
        )}
        {shipment.fulfillment && (
          <Link
            to="/orders/fulfillments/$id"
            params={{ id: shipment.fulfillment.id }}
            className="text-[12px] text-primary hover:underline"
          >
            Fulfillment #{shipment.fulfillment.fulfillment_number}
          </Link>
        )}
      </div>

      {canManage && actions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a} size="sm" variant="outline" onClick={() => setAction(a)}>
              {SHIPMENT_ACTION_LABELS[a]}
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <FormSection
            title="Delivery address snapshot"
            description="Frozen when the shipment was created. Later customer edits never change it."
          >
            <div className="space-y-1 text-[13px]">
              <p className="font-medium">{shipment.recipient_name}</p>
              <p className="text-muted-foreground">{shipment.recipient_phone}</p>
              <p>{shipment.delivery_address}</p>
              <p className="text-muted-foreground">
                {[
                  shipment.delivery_area,
                  shipment.delivery_city,
                  shipment.delivery_zone,
                  shipment.postal_code,
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
            </div>
          </FormSection>

          <FormSection title="Items in this shipment">
            <div className="space-y-2">
              {shipment.items.map((line) => (
                <div
                  key={line.id}
                  className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{line.productName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[line.variantName, line.sku].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <span className="text-[13px] tabular-nums">×{line.quantity}</span>
                </div>
              ))}
            </div>
          </FormSection>

          <FormSection
            title="Courier"
            description="Pick the courier and the account that will carry this shipment. Credentials stay on the server; the browser never sees them."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Provider</label>
                <Select
                  value={providerId}
                  onValueChange={(v) => {
                    setProviderId(v);
                    setServiceType("");
                  }}
                  disabled={!canManage}
                >
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue placeholder="Not assigned" />
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
                  disabled={!canManage || !providerId}
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
            </div>
            <div className="mt-3 space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Account</label>
              <Select
                value={accountId}
                onValueChange={setAccountId}
                disabled={!canManage || !providerId || accounts.length === 0}
              >
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue
                    placeholder={
                      providerId && accounts.length === 0
                        ? "No account configured — manual courier"
                        : "Not assigned"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} · {a.environment}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Without an account this courier is handled manually: the workflow is identical, only
                the automated actions are unavailable.
              </p>
            </div>
            {canManage && (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => courierMutation.mutate()}
                disabled={!providerId || courierMutation.isPending}
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                Save courier
              </Button>
            )}
          </FormSection>

          <FormSection
            title="Courier integration"
            description="What the courier last told us. The internal status above always stays the source of truth."
          >
            <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[11px] text-muted-foreground">Consignment</dt>
                <dd className="tabular-nums">{shipment.external_consignment_id ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Courier status</dt>
                <dd>{shipment.provider_status ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Last synced</dt>
                <dd>
                  {shipment.last_synced_at
                    ? new Date(shipment.last_synced_at).toLocaleString()
                    : "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Delivery fee</dt>
                <dd className="tabular-nums">
                  {shipment.booked_delivery_fee != null
                    ? `${formatMoney(shipment.booked_delivery_fee)} booked`
                    : shipment.quoted_delivery_fee != null
                      ? `${formatMoney(shipment.quoted_delivery_fee)} quoted`
                      : "—"}
                </dd>
              </div>
              {shipment.return_tracking_number && (
                <div>
                  <dt className="text-[11px] text-muted-foreground">Return tracking</dt>
                  <dd className="tabular-nums">{shipment.return_tracking_number}</dd>
                </div>
              )}
              <div>
                <dt className="text-[11px] text-muted-foreground">Booking attempts</dt>
                <dd className="tabular-nums">{shipment.booking_attempt_count ?? 0}</dd>
              </div>
            </dl>

            {shipment.booking_outcome_unknown && (
              <div className="mt-3 space-y-2 rounded border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-[12.5px] font-medium text-destructive">
                  The result of the last booking attempt is unknown
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {shipment.booking_last_error ??
                    "The courier may or may not have created a parcel."}{" "}
                  Booking is blocked until someone confirms with the courier which happened.
                </p>
                {canManage && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={recoveryConsignment}
                        onChange={(e) => setRecoveryConsignment(e.target.value)}
                        placeholder="Consignment the courier created"
                        className="h-8 max-w-xs text-[12.5px]"
                      />
                      <Button
                        size="sm"
                        onClick={() => recoveryMutation.mutate("confirm")}
                        disabled={recoveryMutation.isPending || !recoveryConsignment.trim()}
                      >
                        A parcel exists
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={recoveryReason}
                        onChange={(e) => setRecoveryReason(e.target.value)}
                        placeholder="Who confirmed no parcel exists"
                        className="h-8 max-w-xs text-[12.5px]"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => recoveryMutation.mutate("abandon")}
                        disabled={recoveryMutation.isPending || !recoveryReason.trim()}
                      >
                        No parcel — allow retry
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {canManage && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => apiMutation.mutate("quote")}
                  disabled={apiMutation.isPending || !shipment.courier_account_id}
                >
                  Get quote
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => apiMutation.mutate("book")}
                  disabled={
                    apiMutation.isPending ||
                    !shipment.courier_account_id ||
                    shipment.booking_outcome_unknown ||
                    Boolean(shipment.external_consignment_id)
                  }
                >
                  {apiMutation.isPending ? "Booking…" : "Book with courier"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => apiMutation.mutate("refresh")}
                  disabled={apiMutation.isPending || !shipment.external_consignment_id}
                >
                  Refresh status
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => cancelCourierMutation.mutate()}
                  disabled={
                    cancelCourierMutation.isPending ||
                    !shipment.external_consignment_id ||
                    !reason.trim()
                  }
                  title="Enter a reason in the action dialog field first. Only couriers that support API cancellation accept this."
                >
                  Cancel with courier
                </Button>
              </div>
            )}

            {courierEvents.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Courier messages received
                </p>
                {courierEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-3 rounded border border-border px-3 py-1.5 text-[12px]"
                  >
                    <span className="truncate">
                      {event.provider_event}
                      <span className="ml-2 text-muted-foreground">{event.processing_status}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(event.received_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </FormSection>

          <FormSection
            title="Package & collection"
            description="Cash to collect is an instruction to the courier, not a payment record."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Cash to collect
                </label>
                <Input
                  type="number"
                  min={0}
                  value={cod}
                  onChange={(e) => setCod(e.target.value)}
                  className="h-8 text-[13px]"
                  disabled={!canManage}
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
                  disabled={!canManage}
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
                  disabled={!canManage}
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
                  disabled={!canManage}
                />
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Courier instructions"
                className="min-h-[64px] text-[13px]"
                disabled={!canManage}
              />
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Internal note"
                className="min-h-[64px] text-[13px]"
                disabled={!canManage}
              />
            </div>
            {canManage && (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => detailsMutation.mutate()}
                disabled={detailsMutation.isPending}
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                Save details
              </Button>
            )}
          </FormSection>
        </div>

        <div className="space-y-4">
          <FormSection title="Shipment facts">
            <dl className="space-y-2 text-[13px]">
              <Fact label="Tracking number" value={shipment.tracking_number ?? "—"} />
              <Fact label="Consignment id" value={shipment.external_consignment_id ?? "—"} />
              <Fact
                label="Cash to collect"
                value={formatMoney(Number(shipment.cash_on_delivery_amount))}
              />
              <Fact
                label="Hold reason"
                value={
                  shipment.hold_reason
                    ? SHIPMENT_HOLD_REASON_LABELS[shipment.hold_reason]
                    : "—"
                }
              />
              <Fact
                label="Failure reason"
                value={
                  shipment.failure_reason
                    ? SHIPMENT_FAILURE_REASON_LABELS[shipment.failure_reason]
                    : "—"
                }
              />
              <Fact label="Booked" value={formatDate(shipment.booked_at)} />
              <Fact label="Picked up" value={formatDate(shipment.picked_up_at)} />
              <Fact label="Delivered" value={formatDate(shipment.delivered_at)} />
            </dl>
          </FormSection>

          <FormSection
            title="Shipment history"
            description="Append-only. Entries can never be edited or removed."
          >
            <ol className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-border pl-3">
                  <p className="text-[12px] font-medium">
                    {SHIPMENT_EVENT_LABELS[e.event_type]}
                  </p>
                  <p className="text-[12px] text-muted-foreground">{e.message}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(e.created_at)}</p>
                </li>
              ))}
              {events.length === 0 && (
                <li className="text-[12px] text-muted-foreground">No history yet.</li>
              )}
            </ol>
          </FormSection>
        </div>
      </div>

      <Dialog open={action !== null} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? SHIPMENT_ACTION_LABELS[action] : ""}</DialogTitle>
            <DialogDescription>
              This records an internal operational update and appends to the shipment history.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {needsHold && (
              <Select
                value={holdReason}
                onValueChange={(v) => setHoldReason(v as ShipmentHoldReason)}
              >
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue placeholder="Select a hold reason" />
                </SelectTrigger>
                <SelectContent>
                  {SHIPMENT_HOLD_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {SHIPMENT_HOLD_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {needsFailure && (
              <Select
                value={failureReason}
                onValueChange={(v) => setFailureReason(v as ShipmentFailureReason)}
              >
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue placeholder="Select a failure reason" />
                </SelectTrigger>
                <SelectContent>
                  {SHIPMENT_FAILURE_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {SHIPMENT_FAILURE_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isBooking && (
              <>
                <Input
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  placeholder="Tracking number (optional)"
                  className="h-8 text-[13px]"
                />
                <Input
                  value={consignment}
                  onChange={(e) => setConsignment(e.target.value)}
                  placeholder="Courier consignment id (optional)"
                  className="h-8 text-[13px]"
                />
              </>
            )}
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={needsText ? "Reason (required)" : "Note (optional)"}
              className="min-h-[64px] text-[13px]"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => action && stateMutation.mutate(action)}
              disabled={confirmDisabled}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-right text-[13px]">{value}</dd>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
