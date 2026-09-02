import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getVerificationQueue } from "@/lib/verification";
import { getFulfillmentStatusCounts } from "@/lib/fulfillment-records";
import { getShipmentStatusCounts } from "@/lib/shipping";
import {
  AlertTriangle,
  Activity,
  BarChart3,
  Boxes,
  ListChecks,
  ShoppingCart,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useProfile } from "@/hooks/use-profile";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard · Commerce Operations" },
      {
        name: "description",
        content: "Operations overview: orders, processing queue, stock alerts and activity.",
      },
    ],
  }),
  component: DashboardPage,
});

function Panel({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-border bg-card ${className ?? ""}`}>
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-[12.5px] font-semibold tracking-tight">{title}</h2>
        </div>
        <StatusBadge tone="neutral">Awaiting data</StatusBadge>
      </header>
      {children}
    </section>
  );
}

/** Real counts only — nothing is shown until the database returns rows. */
function VerificationAttention() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["verification-queue", "dashboard"],
    queryFn: () => getVerificationQueue({ limit: 500 }),
  });

  if (isLoading) {
    return <p className="px-3 py-3 text-[12.5px] text-muted-foreground">Loading…</p>;
  }
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        compact
        title="Nothing waiting"
        description="No orders are currently awaiting verification."
      />
    );
  }

  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const stats = [
    { label: "Pending verification", value: rows.filter((r) => r.verification_status === "pending").length },
    { label: "Manual review", value: rows.filter((r) => r.verification_status === "manual_review").length },
    {
      label: "Callbacks today",
      value: rows.filter(
        (r) => r.verification_next_action_at && new Date(r.verification_next_action_at) <= endOfDay,
      ).length,
    },
  ];

  return (
    <ul className="divide-y divide-border">
      {stats.map((s) => (
        <li key={s.label} className="flex items-center justify-between px-3 py-2 text-[13px]">
          <Link to="/orders/verification" className="text-muted-foreground hover:text-foreground">
            {s.label}
          </Link>
          <span className="font-semibold tabular-nums">{s.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Live warehouse counts from real fulfillment records. */
function ProcessingQueue() {
  const { data: counts, isLoading } = useQuery({
    queryKey: ["fulfillment-status-counts", "dashboard"],
    queryFn: () => getFulfillmentStatusCounts(),
  });

  if (isLoading) {
    return <p className="px-3 py-3 text-[12.5px] text-muted-foreground">Loading…</p>;
  }
  const total = Object.values(counts ?? {}).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  if (total === 0) {
    return (
      <EmptyState
        compact
        title="Queue empty"
        description="Fulfillments created from confirmed orders appear here for picking and packing."
      />
    );
  }

  const stats = [
    { label: "Ready to pick", value: counts?.ready_to_pick ?? 0 },
    { label: "Currently picking", value: counts?.picking ?? 0 },
    { label: "QC attention", value: (counts?.qc_pending ?? 0) + (counts?.qc_failed ?? 0) },
    { label: "Ready for handover", value: counts?.packed ?? 0 },
    { label: "On hold", value: counts?.on_hold ?? 0 },
  ];

  return (
    <ul className="divide-y divide-border">
      {stats.map((s) => (
        <li key={s.label} className="flex items-center justify-between px-3 py-2 text-[13px]">
          <Link to="/orders/fulfillment" className="text-muted-foreground hover:text-foreground">
            {s.label}
          </Link>
          <span className="font-semibold tabular-nums">{s.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Live shipping desk counts from real shipment records. */
function ShippingQueue() {
  const { data: counts, isLoading } = useQuery({
    queryKey: ["shipment-status-counts", "dashboard"],
    queryFn: () => getShipmentStatusCounts(),
  });

  if (isLoading) {
    return <p className="px-3 py-3 text-[12.5px] text-muted-foreground">Loading…</p>;
  }
  const total = Object.values(counts ?? {}).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  if (total === 0) {
    return (
      <EmptyState
        compact
        title="Nothing shipping"
        description="Shipments appear here once a packed fulfillment is handed to a courier."
      />
    );
  }

  const stats = [
    {
      label: "Awaiting booking",
      value: (counts?.draft ?? 0) + (counts?.ready_for_booking ?? 0) + (counts?.booking_requested ?? 0),
    },
    { label: "Awaiting pickup", value: (counts?.booked ?? 0) + (counts?.pickup_requested ?? 0) },
    {
      label: "In transit",
      value: (counts?.picked_up ?? 0) + (counts?.in_transit ?? 0) + (counts?.out_for_delivery ?? 0),
    },
    {
      label: "Delivery problems",
      value: (counts?.delivery_on_hold ?? 0) + (counts?.delivery_failed ?? 0),
    },
    {
      label: "Returning",
      value: (counts?.return_requested ?? 0) + (counts?.return_in_transit ?? 0),
    },
  ];

  return (
    <ul className="divide-y divide-border">
      {stats.map((s) => (
        <li key={s.label} className="flex items-center justify-between px-3 py-2 text-[13px]">
          <Link to="/orders/shipments" className="text-muted-foreground hover:text-foreground">
            {s.label}
          </Link>
          <span className="font-semibold tabular-nums">{s.value}</span>
        </li>
      ))}
    </ul>
  );
}



function DashboardPage() {
  const { data: profile } = useProfile();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          profile?.full_name
            ? `Signed in as ${profile.full_name}. Commerce modules connect in the next steps.`
            : "Commerce modules connect in the next steps."
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Today's Orders" icon={ShoppingCart}>
          <EmptyState
            compact
            title="No order data yet"
            description="Connects once the Orders module is built."
          />
        </Panel>
        <Panel title="Verification Attention" icon={AlertTriangle}>
          <VerificationAttention />
        </Panel>
        <Panel title="Processing Queue" icon={ListChecks}>
          <ProcessingQueue />
        </Panel>
        <Panel title="Low Stock" icon={Boxes}>
          <EmptyState
            compact
            title="No stock signals"
            description="Requires the Inventory module."
          />
        </Panel>
        <Panel title="Sales Overview" icon={BarChart3} className="lg:col-span-2">
          <EmptyState
            compact
            title="No sales figures"
            description="Revenue charts stay empty until real orders exist — no placeholder numbers are shown."
          />
        </Panel>
        <Panel title="Recent Activity" icon={Activity} className="lg:col-span-3">
          <EmptyState
            compact
            title="No activity recorded"
            description="Team actions across modules will be logged here."
          />
        </Panel>
      </div>
    </>
  );
}
