import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingState } from "@/components/shared/LoadingState";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { MediaImage } from "@/components/commerce/MediaImage";
import {
  CategoryFormPanel,
  type CategoryFormState,
} from "@/components/commerce/CategoryFormPanel";
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
import {
  archiveCategory,
  getCategories,
  getCategoryProductCounts,
  restoreCategory,
} from "@/lib/commerce";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { ENTITY_STATUS_LABELS, type Category, type EntityStatus } from "@/types/commerce";

export const Route = createFileRoute("/_authenticated/products/categories")({
  head: () => ({
    meta: [
      { title: "Categories · Commerce Operations" },
      {
        name: "description",
        content: "Organize your products into a clear category structure.",
      },
      { property: "og:title", content: "Categories · Commerce Operations" },
      {
        property: "og:description",
        content: "Manage the category tree, hierarchy, media and availability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CategoriesPage,
});

const STATUS_TONE: Record<EntityStatus, StatusTone> = {
  active: "success",
  inactive: "neutral",
  archived: "warning",
};

interface TreeNode {
  category: Category;
  depth: number;
  children: TreeNode[];
}

function buildTree(categories: Category[]): TreeNode[] {
  const byId = new Map(categories.map((c) => [c.id, { category: c, depth: 0, children: [] } as TreeNode]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.category.parent_id ? byId.get(node.category.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortFn = (a: TreeNode, b: TreeNode) =>
    a.category.sort_order - b.category.sort_order ||
    a.category.name.localeCompare(b.category.name);
  const assign = (nodes: TreeNode[], depth: number) => {
    nodes.sort(sortFn);
    for (const n of nodes) {
      n.depth = depth;
      assign(n.children, depth + 1);
    }
  };
  assign(roots, 0);
  return roots;
}

function flatten(nodes: TreeNode[], collapsed: Set<string>, out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    out.push(n);
    if (!collapsed.has(n.category.id)) flatten(n.children, collapsed, out);
  }
  return out;
}

function CategoriesPage() {
  const qc = useQueryClient();
  const perms = useCommercePermissions();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EntityStatus>("active");
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | "visible" | "hidden">("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState<CategoryFormState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Category | null>(null);

  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: () => getCategories() });
  const countsQuery = useQuery({
    queryKey: ["category-counts"],
    queryFn: getCategoryProductCounts,
  });

  const all = categoriesQuery.data ?? [];
  const counts = countsQuery.data ?? {};

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (visibilityFilter !== "all" && c.visibility !== visibilityFilter) return false;
      if (term && !c.name.toLowerCase().includes(term) && !c.slug.toLowerCase().includes(term))
        return false;
      return true;
    });
  }, [all, search, statusFilter, visibilityFilter]);

  const rows = useMemo(() => flatten(buildTree(filtered), collapsed), [filtered, collapsed]);

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveCategory(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category archived");
      setArchiveTarget(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not archive category"),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreCategory(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not restore category"),
  });

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const error = categoriesQuery.error ?? countsQuery.error;

  return (
    <>
      <PageHeader
        title="Categories"
        description="Organize your products into a clear category structure."
        actions={
          perms.canManage ? (
            <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Category
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or slug"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="h-8 w-[130px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={visibilityFilter}
          onValueChange={(v) => setVisibilityFilter(v as typeof visibilityFilter)}
        >
          <SelectTrigger className="h-8 w-[140px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="visible">Visible</SelectItem>
            <SelectItem value="hidden">Hidden</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-card">
        {error ? (
          <p className="px-4 py-6 text-center text-[13px] text-destructive">
            {error instanceof Error ? error.message : "Failed to load categories."}
          </p>
        ) : categoriesQuery.isLoading ? (
          <LoadingState rows={6} label="Loading categories" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title={all.length === 0 ? "No categories yet" : "No matching categories"}
            description={
              all.length === 0
                ? "Create your first category to organize your products."
                : "Try a different search term or adjust the filters."
            }
            action={
              all.length === 0 && perms.canManage ? (
                <Button size="sm" onClick={() => setFormState({ mode: "create" })}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Category
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Category</th>
                  <th className="px-3 py-2 text-right font-semibold">Products</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Visibility</th>
                  <th className="px-3 py-2 text-center font-semibold">Featured</th>
                  <th className="px-3 py-2 text-right font-semibold">Sort</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ category, depth, children }) => {
                  const hasChildren = children.length > 0;
                  const isCollapsed = collapsed.has(category.id);
                  return (
                    <tr key={category.id} className="border-b border-border last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-1.5">
                        <div
                          className="flex items-center gap-2"
                          style={{ paddingLeft: depth * 18 }}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggle(category.id)}
                              aria-label={isCollapsed ? "Expand" : "Collapse"}
                              className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="h-4 w-4" />
                          )}
                          <MediaImage
                            path={category.thumbnail_url}
                            alt={category.name}
                            className="h-7 w-7 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{category.name}</div>
                            <div className="truncate text-[11.5px] text-muted-foreground">
                              /{category.slug}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {counts[category.id] ?? 0}
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge tone={STATUS_TONE[category.status]}>
                          {ENTITY_STATUS_LABELS[category.status]}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge tone={category.visibility === "visible" ? "info" : "neutral"}>
                          {category.visibility === "visible" ? "Visible" : "Hidden"}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-1.5 text-center text-muted-foreground">
                        {category.featured ? "★" : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                        {category.sort_order}
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
                            <DropdownMenuContent align="end" className="w-40">
                              {perms.canManage && (
                                <>
                                  <DropdownMenuItem
                                    onSelect={() => setFormState({ mode: "edit", category })}
                                  >
                                    <Pencil className="mr-2 h-3.5 w-3.5" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setFormState({ mode: "create", parentId: category.id })
                                    }
                                  >
                                    <Plus className="mr-2 h-3.5 w-3.5" />
                                    Add child
                                  </DropdownMenuItem>
                                </>
                              )}
                              {perms.canArchive &&
                                (category.status === "archived" ? (
                                  <DropdownMenuItem
                                    onSelect={() => restoreMutation.mutate(category.id)}
                                  >
                                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                    Restore
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onSelect={() => setArchiveTarget(category)}>
                                    <Archive className="mr-2 h-3.5 w-3.5" />
                                    Archive
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CategoryFormPanel
        state={formState}
        onClose={() => setFormState(null)}
        categories={all}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name ?? "category"}?`}
        description={
          archiveTarget && (counts[archiveTarget.id] ?? 0) > 0
            ? `This category is used by ${counts[archiveTarget.id]} products. Archiving will preserve existing product relationships, but it cannot be assigned to new products.`
            : "Archived categories are hidden from the default view and cannot be assigned to new products."
        }
        confirmLabel="Archive"
        destructive
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
      />
    </>
  );
}
