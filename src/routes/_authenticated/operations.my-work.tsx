import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { AttentionTable } from "@/components/operations/AttentionTable";
import { AttentionDrawer } from "@/components/operations/AttentionDrawer";
import { filterAndSortAttention, getAttentionFeed } from "@/lib/operations";
import { useProfile } from "@/hooks/use-profile";
import type { OperationAttention } from "@/types/operations";

const TITLE = "My Work · Commerce Operations";
const DESCRIPTION = "Operational items currently assigned to you across every workflow queue.";

export const Route = createFileRoute("/_authenticated/operations/my-work")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyWorkPage,
});

function MyWorkPage() {
  const { data: profile } = useProfile();
  const [selected, setSelected] = useState<OperationAttention | null>(null);

  const feed = useQuery({
    queryKey: ["operations", "attention"],
    queryFn: getAttentionFeed,
    staleTime: 30_000,
  });

  const items = useMemo(() => feed.data ?? [], [feed.data]);
  const rows = useMemo(
    () => filterAndSortAttention(items, { assignedTo: profile?.id ?? "none", sort: "severity" }),
    [items, profile?.id],
  );
  const selectedLive = selected ? (items.find((i) => i.id === selected.id) ?? selected) : null;

  return (
    <div>
      <PageHeader
        title="My Work"
        description="Items where you are the current owner. Assignment is a responsibility marker — it never changes workflow state."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/operations">Command Center</Link>
          </Button>
        }
      />

      <div className="rounded border border-border">
        <AttentionTable
          items={rows}
          isLoading={feed.isLoading}
          onSelect={(item) => setSelected(item)}
          emptyTitle="Nothing assigned to you"
          emptyDescription="Pick up work from the Operations Command Center."
        />
      </div>

      <AttentionDrawer item={selectedLive} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
