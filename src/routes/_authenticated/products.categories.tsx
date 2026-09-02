import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingNext } from "@/components/shared/ComingNext";

export const Route = createFileRoute("/_authenticated/products/categories")({
  head: () => ({
    meta: [
      { title: "Categories · Commerce Operations" },
      { name: "description", content: "Category tree used to organise the catalog." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Categories" description="Category tree used to organise the catalog." />
      <ComingNext module="Categories" />
    </>
  );
}
