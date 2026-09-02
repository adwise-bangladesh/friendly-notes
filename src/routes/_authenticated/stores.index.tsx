import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getStoreList, saveStore } from "@/lib/stores";
import { STORE_STATUS_LABELS } from "@/types/stores";
import type { StoreStatus } from "@/types/stores";
import type { StatusTone } from "@/components/shared/StatusBadge";

const TITLE = "Stores & Sales Channels · Commerce Operations";
const DESCRIPTION =
  "The stores you sell through and the channels that feed orders into operations.";

export const Route = createFileRoute("/_authenticated/stores/")({
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

const STATUS_TONE: Record<StoreStatus, StatusTone> = {
  active: "success",
  inactive: "warning",
  archived: "danger",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function Page() {
  const qc = useQueryClient();
  const perms = useCommercePermissions();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StoreStatus | "all">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", code: "" });

  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: getStoreList });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (storesQuery.data ?? []).filter((store) => {
      if (statusFilter !== "all" && store.status !== statusFilter) return false;
      if (!term) return true;
      return (
        store.name.toLowerCase().includes(term) ||
        store.code.toLowerCase().includes(term) ||
        store.slug.toLowerCase().includes(term)
      );
    });
  }, [storesQuery.data, search, statusFilter]);

  const createMutation = useMutation({
    mutationFn: () =>
      saveStore({
        name: form.name.trim(),
        slug: form.slug.trim() || slugify(form.name),
        code: form.code.trim().toUpperCase(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stores"] });
      setOpen(false);
      setForm({ name: "", slug: "", code: "" });
      toast.success("Store created with its internal channel");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not create the store."),
  });

  return (
    <>
      <PageHeader
        title="Stores"
        description={DESCRIPTION}
        actions={
          perms.canArchive ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Store
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stores"
          className="h-8 w-56 text-[13px]"
        />
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StoreStatus | "all")}
        >
          <SelectTrigger className="h-8 w-40 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STORE_STATUS_LABELS) as StoreStatus[]).map((status) => (
              <SelectItem key={status} value={status}>
                {STORE_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {storesQuery.error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {storesQuery.error instanceof Error ? storesQuery.error.message : "Failed to load stores."}
          </p>
        ) : storesQuery.isLoading ? (
          <LoadingState rows={3} label="Loading stores" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={StoreIcon}
            title="No stores yet"
            description="A store groups the sales channels that feed orders into your operations."
            action={
              perms.canArchive ? (
                <Button size="sm" onClick={() => setOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Store
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Store</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Channels</th>
                  <th className="px-3 py-2 text-right font-semibold">Orders</th>
                  <th className="px-3 py-2 text-left font-semibold">Last sync</th>
                  <th className="px-3 py-2 text-left font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((store) => (
                  <tr key={store.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5">
                      <Link
                        to="/stores/$id"
                        params={{ id: store.id }}
                        className="font-medium hover:underline"
                      >
                        {store.name}
                      </Link>
                      <div className="font-mono text-[11.5px] text-muted-foreground">
                        {store.code} · {store.currency} · {store.country}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={STATUS_TONE[store.status]}>
                        {STORE_STATUS_LABELS[store.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{store.channel_count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{store.order_count}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {store.last_sync_at ? new Date(store.last_sync_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {new Date(store.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New store</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="store-name">Name</Label>
              <Input
                id="store-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                    slug: prev.slug || slugify(e.target.value),
                  }))
                }
                placeholder="Velora Website"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="store-slug">Slug</Label>
                <Input
                  id="store-slug"
                  value={form.slug}
                  onChange={(e) => setForm((prev) => ({ ...prev, slug: slugify(e.target.value) }))}
                  placeholder="velora-website"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="store-code">Code</Label>
                <Input
                  id="store-code"
                  value={form.code}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="VELORA"
                />
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Defaults: BDT · Asia/Dhaka · BD. A Manual / Internal channel is created automatically.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!form.name.trim() || !form.code.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create store
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
