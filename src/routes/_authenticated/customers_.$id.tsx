import { useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Flag, MessageSquarePlus, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { AIEntityPanel } from "@/components/ai/AIEntityPanel";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { CustomerIndicators } from "@/components/customers/CustomerIndicators";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { formatMoney } from "@/lib/currency";
import {
  addCustomerNote,
  getCustomer,
  getCustomerFinancialSummary,
  getCustomerFlags,
  getCustomerMetrics,
  getCustomerNotes,
  getCustomerOrders,
  getCustomerReturns,
  getCustomerShipments,
  getCustomerTimeline,
  getCustomerVerification,
  possibleDuplicates,
  setCustomerManualFlag,
  setCustomerStatus,
} from "@/lib/customers";
import {
  CUSTOMER_FLAGS,
  CUSTOMER_FLAG_LABELS,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_TONE,
  TIMELINE_SOURCE_LABELS,
  deriveIndicators,
  formatRate,
} from "@/types/customers";
import type { CustomerManualFlagType } from "@/types/customers";

const DESCRIPTION = "Customer identity, operational reliability and full order history.";

export const Route = createFileRoute("/_authenticated/customers_/$id")({
  head: () => ({
    meta: [
      { title: "Customer Profile · Commerce Operations" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Customer Profile · Commerce Operations" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const PAGE_SIZE = 25;

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-[15px] font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Page() {
  const { id } = useParams({ from: "/_authenticated/customers_/$id" });
  const queryClient = useQueryClient();
  const { canManage, canArchive: isAdmin } = useCommercePermissions();

  const [editOpen, setEditOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagType, setFlagType] = useState<CustomerManualFlagType>("manual_attention");
  const [flagReason, setFlagReason] = useState("");
  const [ordersPage, setOrdersPage] = useState(0);
  const [orderSearch, setOrderSearch] = useState("");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
  };

  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer", id, "identity"],
    queryFn: () => getCustomer(id),
  });
  const { data: metrics } = useQuery({
    queryKey: ["customer", id, "metrics"],
    queryFn: () => getCustomerMetrics(id),
  });
  const { data: flags = [] } = useQuery({
    queryKey: ["customer", id, "flags"],
    queryFn: () => getCustomerFlags(id),
  });
  const { data: notes = [] } = useQuery({
    queryKey: ["customer", id, "notes"],
    queryFn: () => getCustomerNotes(id),
  });
  const { data: duplicates = [] } = useQuery({
    queryKey: ["customer", id, "duplicates"],
    queryFn: () => (customer ? possibleDuplicates(customer) : Promise.resolve([])),
    enabled: !!customer,
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["customer", id, "orders", ordersPage, orderSearch],
    queryFn: () =>
      getCustomerOrders(id, {
        search: orderSearch,
        limit: PAGE_SIZE,
        offset: ordersPage * PAGE_SIZE,
      }),
  });
  const { data: verification = [] } = useQuery({
    queryKey: ["customer", id, "verification", isAdmin],
    queryFn: () => getCustomerVerification(id, { includeRisk: isAdmin }),
  });
  const { data: shipments = [] } = useQuery({
    queryKey: ["customer", id, "shipments"],
    queryFn: () => getCustomerShipments(id),
  });
  const { data: returns = [] } = useQuery({
    queryKey: ["customer", id, "returns"],
    queryFn: () => getCustomerReturns(id),
  });
  const { data: financial } = useQuery({
    queryKey: ["customer", id, "financial"],
    queryFn: () => getCustomerFinancialSummary(id),
  });
  const { data: timeline = [] } = useQuery({
    queryKey: ["customer", id, "timeline"],
    queryFn: () => getCustomerTimeline(id),
  });

  const noteMutation = useMutation({
    mutationFn: () => addCustomerNote(id, noteText.trim()),
    onSuccess: () => {
      setNoteText("");
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["customer", id, "notes"] });
      toast.success("Note added");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add note"),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { status: "active" | "blocked"; reason?: string }) =>
      setCustomerStatus(id, input.status, input.reason),
    onSuccess: () => {
      setBlockOpen(false);
      setBlockReason("");
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["customer", id, "identity"] });
      void queryClient.invalidateQueries({ queryKey: ["customer", id, "notes"] });
      toast.success("Customer status updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update status"),
  });

  const flagMutation = useMutation({
    mutationFn: (input: { flag: CustomerManualFlagType; active: boolean; reason: string }) =>
      setCustomerManualFlag(id, input.flag, input.active, input.reason),
    onSuccess: () => {
      setFlagOpen(false);
      setFlagReason("");
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["customer", id, "flags"] });
      toast.success("Flag updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update flag"),
  });

  if (isLoading) return <LoadingState />;
  if (!customer) {
    return (
      <EmptyState
        title="Customer not found"
        description="This customer may have been removed."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/customers">Back to customers</Link>
          </Button>
        }
      />
    );
  }

  const activeFlags = flags.filter((f) => f.is_active);
  const indicators = metrics
    ? deriveIndicators({
        status: customer.status,
        blockReason: customer.block_reason,
        metrics,
        manualFlags: activeFlags.map((f) => ({ flag: f.flag, reason: f.reason })),
      })
    : [];

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`${customer.primary_phone}${customer.email ? ` · ${customer.email}` : ""}`}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link to="/customers">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Customers
              </Link>
            </Button>
            {canManage && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => setFlagOpen(true)}>
                  <Flag className="mr-1.5 h-3.5 w-3.5" />
                  Flags
                </Button>
              </>
            )}
            {isAdmin &&
              (customer.status === "blocked" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate({ status: "active" })}
                >
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                  Unblock
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => setBlockOpen(true)}>
                  <Ban className="mr-1.5 h-3.5 w-3.5" />
                  Block
                </Button>
              ))}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={CUSTOMER_STATUS_TONE[customer.status]}>
          {CUSTOMER_STATUS_LABELS[customer.status]}
        </StatusBadge>
        <CustomerIndicators indicators={indicators} />
      </div>

      {customer.status === "blocked" && (
        <div className="mb-4 rounded border border-destructive/30 bg-destructive/10 p-3 text-[12.5px] text-destructive">
          This customer is blocked. New orders are rejected until an administrator unblocks them.
          {customer.block_reason ? ` Reason: ${customer.block_reason}` : ""}
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="mb-4 rounded border border-warning/30 bg-warning/10 p-3 text-[12.5px] text-warning-foreground">
          {duplicates.length} other customer record{duplicates.length === 1 ? "" : "s"} share this
          phone number. Detected only — records are never merged automatically.
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="returns">Returns</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="ai">AI Brain</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {metrics && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Total orders" value={String(metrics.total_orders)} />
              <Metric
                label="Confirmed"
                value={String(metrics.confirmed_orders)}
                hint={`${metrics.cancelled_orders} cancelled`}
              />
              <Metric
                label="Delivery success"
                value={formatRate(metrics.delivery_success_rate)}
                hint={`${metrics.delivered_orders} delivered of ${metrics.final_outcome_orders} completed`}
              />
              <Metric
                label="Return rate"
                value={formatRate(metrics.return_rate)}
                hint={`${metrics.returned_orders} returned`}
              />
              <Metric
                label="Verification success"
                value={formatRate(metrics.verification_success_rate)}
                hint={`${metrics.verification_required_orders} orders required verification`}
              />
              <Metric label="Total order value" value={formatMoney(metrics.total_order_value)} />
              <Metric
                label="Delivered revenue"
                value={formatMoney(metrics.delivered_revenue)}
                hint="Money from orders that actually arrived"
              />
              <Metric
                label="Average order value"
                value={
                  metrics.average_order_value === null
                    ? "—"
                    : formatMoney(metrics.average_order_value)
                }
                hint={
                  metrics.first_order_at
                    ? `Since ${new Date(metrics.first_order_at).toLocaleDateString()}`
                    : "No orders yet"
                }
              />
            </div>
          )}
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            All values are calculated live from orders, shipments, returns and verification records.
            Nothing here is stored as a separate counter.
          </p>
        </TabsContent>

        <TabsContent value="orders">
          <div className="mb-3 flex items-center gap-2">
            <Input
              value={orderSearch}
              onChange={(e) => {
                setOrdersPage(0);
                setOrderSearch(e.target.value);
              }}
              placeholder="Search order number"
              className="h-8 w-56 text-[13px]"
            />
          </div>
          {orders.length === 0 ? (
            <EmptyState title="No orders" description="This customer has no orders yet." compact />
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Verification</th>
                    <th className="px-3 py-2 font-medium">Delivery</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link
                          to="/orders/$id"
                          params={{ id: o.id }}
                          className="text-primary hover:underline"
                        >
                          {o.order_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(o.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">{o.status}</td>
                      <td className="px-3 py-2">{o.verification_status}</td>
                      <td className="px-3 py-2">{o.delivery_status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(o.grand_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={ordersPage === 0}
              onClick={() => setOrdersPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={orders.length < PAGE_SIZE}
              onClick={() => setOrdersPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="verification">
          {verification.length === 0 ? (
            <EmptyState
              title="No verification history"
              description="No order for this customer has required verification."
              compact
            />
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Attempts</th>
                    <th className="px-3 py-2 font-medium">Last attempt</th>
                    <th className="px-3 py-2 font-medium">Last outcome</th>
                    {isAdmin && <th className="px-3 py-2 font-medium">Risk</th>}
                  </tr>
                </thead>
                <tbody>
                  {verification.map((v) => (
                    <tr key={v.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link
                          to="/orders/$id"
                          params={{ id: v.id }}
                          className="text-primary hover:underline"
                        >
                          {v.order_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{v.verification_status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {v.verification_attempt_count}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {v.verification_last_attempt_at
                          ? new Date(v.verification_last_attempt_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{v.lastOutcome ?? "—"}</td>
                      {isAdmin && <td className="px-3 py-2">{v.risk_level ?? "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="delivery">
          {shipments.length === 0 ? (
            <EmptyState title="No shipments" description="Nothing has shipped yet." compact />
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Shipment</th>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Courier</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Tracking</th>
                    <th className="px-3 py-2 text-right font-medium">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link
                          to="/orders/shipments/$id"
                          params={{ id: s.id }}
                          className="text-primary hover:underline"
                        >
                          {s.shipment_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{s.order?.order_number ?? "—"}</td>
                      <td className="px-3 py-2">{s.courier?.name ?? "—"}</td>
                      <td className="px-3 py-2">{s.status}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.tracking_number ?? s.external_consignment_id ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.collected_amount === null ? "—" : formatMoney(s.collected_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="returns">
          {returns.length === 0 ? (
            <EmptyState title="No returns" description="No return has been raised." compact />
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Return</th>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link
                          to="/returns/$id"
                          params={{ id: r.id }}
                          className="text-primary hover:underline"
                        >
                          {r.return_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{r.order?.order_number ?? "—"}</td>
                      <td className="px-3 py-2">{r.return_type}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.condition ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="financial">
          {financial && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Gross order value"
                  value={formatMoney(financial.gross_order_value)}
                />
                <Metric
                  label="Delivered revenue"
                  value={formatMoney(financial.delivered_revenue)}
                />
                <Metric
                  label="Actual profit"
                  value={formatMoney(financial.actual_profit)}
                  hint={`${financial.actual_orders} fully settled orders`}
                />
                <Metric
                  label="Estimated profit"
                  value={formatMoney(financial.estimated_profit)}
                  hint={`${financial.estimated_orders} orders still estimated`}
                />
              </div>
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                Profit uses the same order financial engine as the order screens:{" "}
                {financial.actual_orders} actual, {financial.partially_actual_orders} partially
                actual, {financial.estimated_orders} estimated.
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          {timeline.length === 0 ? (
            <EmptyState title="No activity yet" compact />
          ) : (
            <ol className="space-y-2">
              {timeline.map((event, index) => (
                <li
                  key={`${event.at}-${index}`}
                  className="rounded border border-border px-3 py-2 text-[13px]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="neutral">
                      {TIMELINE_SOURCE_LABELS[event.source]}
                    </StatusBadge>
                    <span className="font-medium">{event.title}</span>
                    {event.order_id && (
                      <Link
                        to="/orders/$id"
                        params={{ id: event.order_id }}
                        className="text-[12px] text-primary hover:underline"
                      >
                        {event.reference ?? "Open order"}
                      </Link>
                    )}
                    <span className="ml-auto text-[11.5px] text-muted-foreground">
                      {new Date(event.at).toLocaleString()}
                    </span>
                  </div>
                  {event.detail && (
                    <p className="mt-1 text-[12.5px] text-muted-foreground">{event.detail}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="notes">
          <FormSection
            title="Internal notes"
            description="Append-only. Notes cannot be edited or deleted once saved."
          >
            {canManage && (
              <div className="mb-3 space-y-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add an internal note about this customer"
                  className="text-[13px]"
                />
                <Button
                  size="sm"
                  disabled={!noteText.trim() || noteMutation.isPending}
                  onClick={() => noteMutation.mutate()}
                >
                  <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
                  Add note
                </Button>
              </div>
            )}
            {notes.length === 0 ? (
              <EmptyState title="No notes yet" compact />
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded border border-border px-3 py-2 text-[13px]">
                    <p className="whitespace-pre-wrap">{n.note}</p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      {n.authorName ?? "Unknown user"} · {new Date(n.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          {flags.length > 0 && (
            <FormSection
              title="Manual flags"
              description="Raised by your team, always separate from calculated indicators."
            >
              <ul className="space-y-2">
                {flags.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-2 text-[13px]"
                  >
                    <StatusBadge tone={f.is_active ? "warning" : "neutral"}>
                      {CUSTOMER_FLAG_LABELS[f.flag]}
                    </StatusBadge>
                    <span className="text-muted-foreground">{f.reason}</span>
                    <span className="ml-auto text-[11.5px] text-muted-foreground">
                      {f.is_active ? "Active" : "Cleared"} ·{" "}
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                    {canManage && f.is_active && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          flagMutation.mutate({
                            flag: f.flag,
                            active: false,
                            reason: "Cleared from customer profile",
                          })
                        }
                      >
                        Clear
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </FormSection>
          )}
        </TabsContent>
        <TabsContent value="ai">
          <AIEntityPanel entityType="customer" entityId={customer.id} analysisType="customer_review" />
        </TabsContent>
      </Tabs>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />

      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Block customer</DialogTitle>
            <DialogDescription>
              Blocking prevents new orders for this customer. A reason is required and is recorded
              permanently as a note.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="Why is this customer being blocked?"
            className="text-[13px]"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBlockOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!blockReason.trim() || statusMutation.isPending}
              onClick={() =>
                statusMutation.mutate({ status: "blocked", reason: blockReason.trim() })
              }
            >
              Block customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={flagOpen} onOpenChange={setFlagOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Raise a manual flag</DialogTitle>
            <DialogDescription>
              Manual flags are shown separately from calculated indicators and always require a
              reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select
              value={flagType}
              onValueChange={(v) => setFlagType(v as CustomerManualFlagType)}
            >
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_FLAGS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {CUSTOMER_FLAG_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Reason for this flag"
              className="text-[13px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFlagOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!flagReason.trim() || flagMutation.isPending}
              onClick={() =>
                flagMutation.mutate({ flag: flagType, active: true, reason: flagReason.trim() })
              }
            >
              Save flag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
