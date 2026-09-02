import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingNext } from "@/components/shared/ComingNext";

export const Route = createFileRoute("/_authenticated/products/")({
  head: () => ({
    meta: [
      { title: "All Products · Commerce Operations" },
      { name: "description", content: "Product catalog with variants, pricing and media." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="All Products" description="Product catalog with variants, pricing and media." />
      <ComingNext module="Products" />
    </>
  );
}
