import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  assignOperationalWork,
  formatAge,
  formatDue,
  getAssignableStaff,
  getAssignmentHistory,
  releaseOperationalWork,
  suggestedAction,
} from "@/lib/operations";
import {
  OPERATION_CATEGORY_LABELS,
  OPERATION_SEVERITY_LABELS,
  OPERATION_SEVERITY_TONE,
} from "@/types/operations";
import type { OperationAttention } from "@/types/operations";
import { useCommercePermissions } from "@/hooks/use-permissions";

export function AttentionDrawer({
  item,
  onOpenChange,
}: {
  item: OperationAttention | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();
  const [assignee, setAssignee] = useState<string>("");
  const [note, setNote] = useState("");

  const assignmentSource = item?.assignment_source_type ?? null;

  const staff = useQuery({
    queryKey: ["operations", "staff"],
    queryFn: getAssignableStaff,
    enabled: Boolean(item?.assignable),
    staleTime: 300_000,
  });

  const history = useQuery({
    queryKey: ["operations", "assignment-history", assignmentSource, item?.source_id],
    queryFn: () => getAssignmentHistory(assignmentSource!, item!.source_id),
    enabled: Boolean(assignmentSource && item?.source_id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["operations"] });
  };

  const assign = useMutation({
    mutationFn: () =>
      assignOperationalWork({
        sourceType: assignmentSource!,
        sourceId: item!.source_id,
        assignedTo: assignee,
        note,
      }),
    onSuccess: () => {
      toast.success("Work assigned");
      setNote("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const release = useMutation({
    mutationFn: () => releaseOperationalWork(assignmentSource!, item!.source_id, note),
    onSuccess: () => {
      toast.success("Assignment released");
      setNote("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!item) return null;
  const action = suggestedAction(item);
  const due = formatDue(item);

  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-[15px]">{item.title}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={OPERATION_SEVERITY_TONE[item.severity]}>
              {OPERATION_SEVERITY_LABELS[item.severity]}
            </StatusBadge>
            <StatusBadge>{OPERATION_CATEGORY_LABELS[item.category]}</StatusBadge>
            <StatusBadge>{item.state.replace(/_/g, " ")}</StatusBadge>
          </div>

          <div className="space-y-1">
            <p className="text-muted-foreground">{item.subtitle}</p>
            <p className="font-medium">{item.reason}</p>
            <p className="text-[12px] text-muted-foreground">
              Age {formatAge(item.occurred_at)}
              {due ? ` · ${due}` : ""}
            </p>
          </div>

          <div className="rounded border border-border p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Suggested next action
            </p>
            <Button asChild size="sm">
              <Link to={action.href}>{action.label}</Link>
            </Button>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Suggestions are navigational only — nothing is executed automatically.
            </p>
          </div>

          {item.assignable && assignmentSource && (
            <div className="space-y-2 rounded border border-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Responsibility
              </p>
              <p className="text-[12.5px]">
                {item.assigned_to_name
                  ? `Assigned to ${item.assigned_to_name}`
                  : "Unassigned"}
              </p>

              {canManage && (
                <>
                  <Select value={assignee} onValueChange={setAssignee}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select a person" />
                    </SelectTrigger>
                    <SelectContent>
                      {(staff.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name ?? p.id.slice(0, 8)} · {p.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note"
                    className="min-h-[60px] text-[13px]"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!assignee || assign.isPending}
                      onClick={() => assign.mutate()}
                    >
                      {item.assigned_to ? "Reassign" : "Assign"}
                    </Button>
                    {item.assigned_to && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={release.isPending}
                        onClick={() => release.mutate()}
                      >
                        Release
                      </Button>
                    )}
                  </div>
                </>
              )}

              {(history.data ?? []).length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border pt-2 text-[12px] text-muted-foreground">
                  {(history.data ?? []).map((e) => (
                    <li key={e.id}>
                      {e.event_type} · {new Date(e.created_at).toLocaleString()}
                      {e.note ? ` · ${e.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
