import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SupplierFormPanel } from "@/components/procurement/SupplierFormPanel";
import type { SupplierFormState } from "@/components/procurement/SupplierFormPanel";
import { SupplierContactsCard } from "@/components/procurement/SupplierContactsCard";
import { SupplierProductsCard } from "@/components/procurement/SupplierProductsCard";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getPurchaseOrders, getSupplier } from "@/lib/procurement";
import { formatCurrencyAmount } from "@/lib/currency";
import {
  PO_STATUS_LABELS,
  PO_STATUS_TONE,
  SUPPLIER_STATUS_LABELS,
  SUPPLIER_STATUS_TONE,
} from "@/types/procurement";

const TITLE = "Supplier · Commerce Operations";
const DESCRIPTION = "Supplier profile, contacts, supplied items and purchase history.";

export const Route = createFileRoute("/_authenticated/suppliers/$id")({
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
  const { id } = Route.useParams();
  const perms = useCommercePermissions();
  const [formState, setFormState] = useState<SupplierFormState | null>(null);

  const supplierQuery = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => getSupplier(id),
  });

  const ordersQuery = useQuery({
    queryKey: ["purchase-orders", { supplierId: id }],
    queryFn: () => getPurchaseOrders({ supplierId: id }),
  });

  const supplier = supplierQuery.data;

  if (supplierQuery.isLoading) return <LoadingState rows={6} label="Loading supplier" />;
  if (!supplier) {
    return (
      <EmptyState
        title="Supplier not found"
        description="This supplier may have been removed."
        action={
          <Button size="sm" variant="outline" asChild>
            <Link to="/suppliers">Back to suppliers</Link>
          </Button>
        }
      />
    );
  }

  const orders = ordersQuery.data ?? [];

  return (
    <>
      <PageHeader
        title={supplier.name}
        description={`${supplier.supplier_code} · ${supplier.default_currency}`}
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/suppliers">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Suppliers
              </Link>
            </Button>
            {perms.canManage && (
              <Button size="sm" onClick={() => setFormState({ mode: "edit", supplier })}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <SupplierProductsCard
            supplierId={supplier.id}
            currency={supplier.default_currency}
            canManage={perms.canManage}
          />

          <section className="rounded-md border border-border bg-card">
            <header className="border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Purchase history</h2>
            </header>
            {orders.length === 0 ? (
              <EmptyState
                compact
                title="No purchase orders yet"
                description="Purchase orders raised with this supplier will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {orders.map((po) => (
                  <li key={po.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <Link
                        to="/procurement/purchase-orders/$id"
                        params={{ id: po.id }}
                        className="font-mono text-[12.5px] text-primary hover:underline"
                      >
                        {po.purchase_order_number}
                      </Link>
                      <p className="text-[12px] text-muted-foreground">{po.order_date}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge tone={PO_STATUS_TONE[po.status]}>
                        {PO_STATUS_LABELS[po.status]}
                      </StatusBadge>
                      <span className="tabular-nums text-[13px]">
                        {formatCurrencyAmount(po.grand_total, po.currency)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold">Profile</h2>
              <StatusBadge tone={SUPPLIER_STATUS_TONE[supplier.status]}>
                {SUPPLIER_STATUS_LABELS[supplier.status]}
              </StatusBadge>
            </div>
            <dl className="space-y-1.5 text-[13px]">
              {[
                ["Contact person", supplier.contact_person],
                ["Phone", supplier.phone],
                ["Email", supplier.email],
                ["Address", supplier.address],
                ["City", supplier.city],
                ["Country", supplier.country],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value || "—"}</dd>
                </div>
              ))}
            </dl>
            {supplier.notes && (
              <p className="mt-3 border-t border-border pt-3 text-[12.5px] text-muted-foreground">
                {supplier.notes}
              </p>
            )}
          </section>

          <SupplierContactsCard supplierId={supplier.id} canManage={perms.canManage} />
        </aside>
      </div>

      <SupplierFormPanel state={formState} onClose={() => setFormState(null)} />
    </>
  );
}
