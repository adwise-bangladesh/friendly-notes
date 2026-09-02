import { createFileRoute } from "@tanstack/react-router";
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
        <Panel title="Orders Requiring Attention" icon={AlertTriangle}>
          <EmptyState
            compact
            title="Nothing to review"
            description="Failed deliveries and holds will surface here."
          />
        </Panel>
        <Panel title="Processing Queue" icon={ListChecks}>
          <EmptyState
            compact
            title="Queue empty"
            description="Pick, pack and dispatch stages appear here."
          />
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
