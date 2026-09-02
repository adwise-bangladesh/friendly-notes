import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getVerificationQueue } from "@/lib/verification";
import { getFulfillmentQueue } from "@/lib/fulfillment";
import { FULFILLMENT_STATUS_LABELS } from "@/types/fulfillment";
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

/** Live warehouse counts — pick / pack / hold work waiting right now. */
function ProcessingQueue() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["fulfillment-queue", "dashboard"],
    queryFn: () => getFulfillmentQueue({ limit: 500 }),
  });

  if (isLoading) {
    return <p className="px-3 py-3 text-[12.5px] text-muted-foreground">Loading…</p>;
  }
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        compact
        title="Queue empty"
        description="Confirmed orders with stock held appear here for picking and packing."
      />
    );
  }

  const stats = (["ready", "picking", "packing", "packed", "on_hold"] as const).map((s) => ({
    label: FULFILLMENT_STATUS_LABELS[s],
    value: rows.filter((r) => r.fulfillment_status === s).length,
  }));

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
