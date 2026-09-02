import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingNext } from "@/components/shared/ComingNext";

export const Route = createFileRoute("/_authenticated/products/brands")({
  head: () => ({
    meta: [
      { title: "Brands · Commerce Operations" },
      { name: "description", content: "Brand records linked to products." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Brands" description="Brand records linked to products." />
      <ComingNext module="Brands" />
    </>
  );
}
