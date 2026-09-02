import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { PurchaseOrderEditor } from "@/components/procurement/PurchaseOrderEditor";
import { useCommercePermissions } from "@/hooks/use-permissions";

const TITLE = "New Purchase Order · Commerce Operations";
const DESCRIPTION = "Raise a draft purchase order for a supplier before goods are ordered.";

export const Route = createFileRoute("/_authenticated/procurement/purchase-orders/new")({
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
  component: Page,
});

function Page() {
  const perms = useCommercePermissions();

  return (
    <>
      <PageHeader
        title="New Purchase Order"
        description={DESCRIPTION}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/procurement/purchase-orders">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Purchase Orders
            </Link>
          </Button>
        }
      />
      {perms.canManage ? (
        <PurchaseOrderEditor />
      ) : (
        <EmptyState
          title="You cannot raise purchase orders"
          description="Ask an owner or admin for staff access to procurement."
        />
      )}
    </>
  );
}
