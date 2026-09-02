import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Factory, MoreHorizontal, Pencil, Plus, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SupplierFormPanel } from "@/components/procurement/SupplierFormPanel";
import type { SupplierFormState } from "@/components/procurement/SupplierFormPanel";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { archiveSupplier, getSuppliers, restoreSupplier } from "@/lib/procurement";
import {
  SUPPLIER_STATUSES,
  SUPPLIER_STATUS_LABELS,
  SUPPLIER_STATUS_TONE,
} from "@/types/procurement";
import type { SupplierListRow, SupplierStatus } from "@/types/procurement";

const TITLE = "Suppliers · Commerce Operations";
const DESCRIPTION = "The vendors you buy stock from, with contacts, terms and purchase history.";

export const Route = createFileRoute("/_authenticated/suppliers/")({
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
  const qc = useQueryClient();
  const perms = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SupplierStatus | "all">("all");
  const [formState, setFormState] = useState<SupplierFormState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SupplierListRow | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => getSuppliers(),
  });

  const rows = useMemo(() => {
    let list = suppliersQuery.data ?? [];
    if (status !== "all") list = list.filter((r) => r.status === status);
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.supplier_code.toLowerCase().includes(term) ||
          (r.phone ?? "").toLowerCase().includes(term),
      );
    }
    return list;
  }, [suppliersQuery.data, search, status]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["suppliers"] });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveSupplier(id),
    onSuccess: () => {
      invalidate();
      setArchiveTarget(null);
      toast.success("Supplier archived");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not archive."),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreSupplier(id),
    onSuccess: () => {
      invalidate();
      toast.success("Supplier restored");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not restore."),
  });

  return (
    <>
      <PageHeader
        title="Suppliers"
        description={DESCRIPTION}
        actions={
          perms.canManage ? (
            <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Supplier
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code or phone"
            className="h-8 pl-8 text-[13px]"
            aria-label="Search suppliers"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as SupplierStatus | "all")}>
          <SelectTrigger className="h-8 w-[160px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SUPPLIER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SUPPLIER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {suppliersQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {suppliersQuery.error instanceof Error
              ? suppliersQuery.error.message
              : "Failed to load suppliers."}
          </p>
        ) : suppliersQuery.isLoading ? (
          <LoadingState rows={5} label="Loading suppliers" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Factory}
            title="No suppliers yet"
            description="Add the vendors you purchase stock from to start raising purchase orders."
            action={
              perms.canManage ? (
                <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Supplier
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Supplier</th>
                  <th className="px-3 py-2 text-left font-semibold">Code</th>
                  <th className="px-3 py-2 text-left font-semibold">Primary contact</th>
                  <th className="px-3 py-2 text-right font-semibold">Items</th>
                  <th className="px-3 py-2 text-right font-semibold">POs</th>
                  <th className="px-3 py-2 text-left font-semibold">Currency</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5">
                      <Link
                        to="/suppliers/$id"
                        params={{ id: s.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.city && (
                        <div className="text-[11.5px] text-muted-foreground">{s.city}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-muted-foreground">
                      {s.supplier_code}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {s.primaryContactName ?? s.contact_person ?? "—"}
                      {(s.primaryContactPhone ?? s.phone) && (
                        <div className="text-[11.5px]">{s.primaryContactPhone ?? s.phone}</div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.productCount}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.purchaseOrderCount}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{s.default_currency}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={SUPPLIER_STATUS_TONE[s.status]}>
                        {SUPPLIER_STATUS_LABELS[s.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {(perms.canManage || perms.canArchive) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            {perms.canManage && (
                              <DropdownMenuItem
                                onSelect={() => setFormState({ mode: "edit", supplier: s })}
                              >
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            {perms.canArchive &&
                              (s.status === "archived" ? (
                                <DropdownMenuItem onSelect={() => restoreMutation.mutate(s.id)}>
                                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                  Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => setArchiveTarget(s)}>
                                  <Archive className="mr-2 h-3.5 w-3.5" />
                                  Archive
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SupplierFormPanel state={formState} onClose={() => setFormState(null)} />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name ?? "supplier"}?`}
        description="Archived suppliers cannot be used on new purchase orders. Existing history is kept."
        confirmLabel="Archive"
        destructive
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
      />
    </>
  );
}
