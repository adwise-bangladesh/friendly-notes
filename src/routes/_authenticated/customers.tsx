import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingNext } from "@/components/shared/ComingNext";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers · Commerce Operations" },
      { name: "description", content: "Customer records, contact details and order history." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Customers" description="Customer records, contact details and order history." />
      <ComingNext module="Customers" />
    </>
  );
}
