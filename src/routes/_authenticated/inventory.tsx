import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingNext } from "@/components/shared/ComingNext";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory · Commerce Operations" },
      { name: "description", content: "Stock levels, adjustments and warehouse movements." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Inventory" description="Stock levels, adjustments and warehouse movements." />
      <ComingNext module="Inventory" />
    </>
  );
}
