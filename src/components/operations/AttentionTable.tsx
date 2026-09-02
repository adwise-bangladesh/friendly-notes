import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { formatAge, formatDue, isOverdue } from "@/lib/operations";
import {
  OPERATION_CATEGORY_LABELS,
  OPERATION_SEVERITY_LABELS,
  OPERATION_SEVERITY_TONE,
} from "@/types/operations";
import type { OperationAttention } from "@/types/operations";

export function AttentionTable({
  items,
  isLoading,
  onSelect,
  emptyTitle = "Nothing needs attention",
  emptyDescription = "All operational queues are clear for the current filters.",
}: {
  items: OperationAttention[];
  isLoading?: boolean;
  onSelect: (item: OperationAttention) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const columns: Column<OperationAttention>[] = [
    {
      key: "severity",
      header: "Severity",
      width: "110px",
      render: (row) => (
        <StatusBadge tone={OPERATION_SEVERITY_TONE[row.severity]}>
          {OPERATION_SEVERITY_LABELS[row.severity]}
        </StatusBadge>
      ),
    },
    {
      key: "category",
      header: "Area",
      width: "120px",
      render: (row) => (
        <span className="text-muted-foreground">{OPERATION_CATEGORY_LABELS[row.category]}</span>
      ),
    },
    {
      key: "item",
      header: "Item",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.title}</p>
          {row.subtitle && (
            <p className="truncate text-[12px] text-muted-foreground">{row.subtitle}</p>
          )}
        </div>
      ),
    },
    {
      key: "reason",
      header: "Why",
      render: (row) => <span className="text-[12.5px]">{row.reason}</span>,
    },
    {
      key: "age",
      header: "Age",
      width: "90px",
      render: (row) => <span className="tabular-nums">{formatAge(row.occurred_at)}</span>,
    },
    {
      key: "due",
      header: "Due",
      width: "150px",
      render: (row) => {
        const due = formatDue(row);
        if (!due) return <span className="text-muted-foreground">—</span>;
        return (
          <span className={isOverdue(row) ? "text-destructive" : "text-muted-foreground"}>
            {due}
          </span>
        );
      },
    },
    {
      key: "assignee",
      header: "Owner",
      width: "140px",
      render: (row) =>
        row.assigned_to_name ? (
          <span>{row.assigned_to_name}</span>
        ) : (
          <span className="text-muted-foreground">{row.assignable ? "Unassigned" : "—"}</span>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(row) => row.id}
      {...(isLoading !== undefined ? { isLoading } : {})}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      onRowClick={onSelect}
    />
  );
}
