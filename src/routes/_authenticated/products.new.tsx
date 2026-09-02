import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProductEditor } from "@/components/commerce/ProductEditor";
import { useCommercePermissions } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/products/new")({
  head: () => ({
    meta: [
      { title: "New Product · Commerce Operations" },
      {
        name: "description",
        content: "Create a product with pricing, media, categories and variants.",
      },
      { property: "og:title", content: "New Product · Commerce Operations" },
      {
        property: "og:description",
        content: "Create a product with pricing, media, categories and variants.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { canManage, isLoading } = useCommercePermissions();

  return (
    <>
      <PageHeader
        title="New Product"
        description="Create a product, then refine pricing, media and variants."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/products">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to Products
            </Link>
          </Button>
        }
      />
      {!isLoading && !canManage ? (
        <p className="rounded-md border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
          You have read-only access. Ask an admin for staff permissions to create products.
        </p>
      ) : (
        <ProductEditor />
      )}
    </>
  );
}
