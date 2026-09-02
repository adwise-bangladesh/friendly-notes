import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { CustomerFormDialog } from "@/components/customers/CustomerFormDialog";
import { CustomerIndicators } from "@/components/customers/CustomerIndicators";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getCustomerList } from "@/lib/customers";
import {
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_TONE,
  deriveIndicators,
  formatRate,
} from "@/types/customers";
import type { CustomerStatus } from "@/types/customers";

const TITLE = "Customers · Commerce Operations";
const DESCRIPTION =
  "Customer identity, order history and operational reliability across your Bangladesh operation.";
const PAGE_SIZE = 25;

export const Route = createFileRoute("/_authenticated/customers/")({
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
  const { canManage } = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CustomerStatus | "all">("all");
  const [customerType, setCustomerType] = useState<"all" | "new" | "repeat">("all");
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const filters = { search, status, customerType, attention };

  const { data, isLoading } = useQuery({
    queryKey: ["customers", filters, page],
    queryFn: () => getCustomerList({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.approx_total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(0);
      setter(value);
    };
  }

  return (
    <>
      <PageHeader
        title="Customers"
        description="One identity per phone number. Every number below is calculated from live orders."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New customer
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search name, phone or email"
          className="h-8 w-64 text-[13px]"
        />
        <Select
          value={status}
          onValueChange={(v) => resetPage(setStatus)(v as CustomerStatus | "all")}
        >
          <SelectTrigger className="h-8 w-36 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CUSTOMER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {CUSTOMER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={customerType}
          onValueChange={(v) => resetPage(setCustomerType)(v as "all" | "new" | "repeat")}
        >
          <SelectTrigger className="h-8 w-36 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All customers</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="repeat">Repeat</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Checkbox
            checked={attention}
            onCheckedChange={(v) => resetPage(setAttention)(v === true)}
          />
          Needs attention
        </label>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers found"
          description="Customers are created automatically when an order is placed, or manually here."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 text-right font-medium">Orders</th>
                  <th className="px-3 py-2 text-right font-medium">Delivery success</th>
                  <th className="px-3 py-2 text-right font-medium">Return rate</th>
                  <th className="px-3 py-2 font-medium">Last order</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const indicators = deriveIndicators({
                    status: row.status,
                    metrics: {
                      total_orders: row.total_orders,
                      delivered_orders: row.delivered_orders,
                      returned_orders: row.returned_orders,
                      failed_deliveries: row.failed_deliveries,
                      verification_failure_orders: row.verification_failures,
                      return_rate: row.return_rate,
                      is_repeat_customer: row.is_repeat_customer,
                    },
                    manualFlags: row.has_manual_flag
                      ? [{ flag: "manual_attention", reason: "See customer profile for details." }]
                      : [],
                  });
                  return (
                    <tr key={row.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <Link
                          to="/customers/$id"
                          params={{ id: row.id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {row.name}
                        </Link>
                        <CustomerIndicators
                          indicators={indicators}
                          className="mt-1 flex flex-wrap gap-1"
                        />
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.primary_phone}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.total_orders}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatRate(row.delivery_success_rate)}
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          ({row.delivered_orders}/{row.final_orders})
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatRate(row.return_rate)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.last_order_at ? new Date(row.last_order_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={CUSTOMER_STATUS_TONE[row.status]}>
                          {CUSTOMER_STATUS_LABELS[row.status]}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-[12.5px] text-muted-foreground">
            <span>
              {total} customer{total === 1 ? "" : "s"} · page {page + 1} of {pageCount}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <CustomerFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
