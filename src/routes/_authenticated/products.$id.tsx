import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ProductEditor } from "@/components/commerce/ProductEditor";
import { ProductStoreAssignments } from "@/components/stores/ProductStoreAssignments";
import { getProductEditorRecord } from "@/lib/products";
import { PRODUCT_STATUS_LABELS } from "@/types/commerce";
import type { ProductStatus } from "@/types/commerce";
import type { StatusTone } from "@/components/shared/StatusBadge";

const STATUS_TONE: Record<ProductStatus, StatusTone> = {
  draft: "neutral",
  active: "success",
  inactive: "warning",
  archived: "danger",
};

export const Route = createFileRoute("/_authenticated/products/$id")({
  head: () => ({
    meta: [
      { title: "Edit Product · Commerce Operations" },
      {
        name: "description",
        content: "Edit product details, pricing, media, variants and related products.",
      },
      { property: "og:title", content: "Edit Product · Commerce Operations" },
      {
        property: "og:description",
        content: "Edit product details, pricing, media, variants and related products.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
  errorComponent: ErrorView,
  notFoundComponent: () => <EmptyState title="Product not found" />,
});

function ErrorView({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <EmptyState
      title="Could not load this product"
      description={error.message}
      action={
        <Button size="sm" variant="outline" onClick={() => void router.invalidate()}>
          Try again
        </Button>
      }
    />
  );
}

function Page() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: () => getProductEditorRecord(id),
  });

  const backButton = (
    <Button asChild size="sm" variant="outline">
      <Link to="/products">
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
        Back to Products
      </Link>
    </Button>
  );

  if (isLoading) return <LoadingState />;

  if (!data) {
    return (
      <>
        <PageHeader title="Product" actions={backButton} />
        <EmptyState
          title="Product not found"
          description="It may have been deleted, or you may not have access to it."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={data.name}
        description={`/${data.slug}`}
        actions={
          <>
            <StatusBadge tone={STATUS_TONE[data.status]}>
              {PRODUCT_STATUS_LABELS[data.status]}
            </StatusBadge>
            {backButton}
          </>
        }
      />
      <ProductEditor record={data} />
      <ProductStoreAssignments productId={id} />
    </>
  );
}
