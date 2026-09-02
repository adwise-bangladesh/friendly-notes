import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingNext } from "@/components/shared/ComingNext";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "Orders · Commerce Operations" },
      { name: "description", content: "Order intake, fulfillment and dispatch tracking for Bangladesh operations." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Orders" description="Order intake, fulfillment and dispatch tracking for Bangladesh operations." />
      <ComingNext module="Orders" />
    </>
  );
}
