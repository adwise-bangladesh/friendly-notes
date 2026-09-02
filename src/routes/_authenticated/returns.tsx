import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingNext } from "@/components/shared/ComingNext";

export const Route = createFileRoute("/_authenticated/returns")({
  head: () => ({
    meta: [
      { title: "Returns · Commerce Operations" },
      { name: "description", content: "Return requests, inspection and refund handling." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="Returns" description="Return requests, inspection and refund handling." />
      <ComingNext module="Returns" />
    </>
  );
}
