import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Pause, Pencil, Play, Plus, Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { AutomationRuleDialog } from "@/components/automation/AutomationRuleDialog";
import { useCommercePermissions } from "@/hooks/use-permissions";
import { getAssignableStaff } from "@/lib/operations";
import {
  describeAction,
  describeCondition,
  getAutomationRegistry,
  getAutomationRules,
  saveAutomationRule,
  setAutomationRuleStatus,
} from "@/lib/automation";
import type { AutomationRuleInput } from "@/lib/automation";
import type { AutomationRule } from "@/types/automation";
import { AUTOMATION_STATUS_TONE } from "@/types/automation";

const TITLE = "Automation Rules · Commerce Operations";
const DESCRIPTION =
  "Deterministic workflow rules that react to real operational events and run controlled actions.";

export const Route = createFileRoute("/_authenticated/automation/")({
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
  component: AutomationRulesPage,
});

function AutomationRulesPage() {
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [archiving, setArchiving] = useState<AutomationRule | null>(null);

  const rules = useQuery({ queryKey: ["automation", "rules"], queryFn: () => getAutomationRules() });
  const registry = useQuery({
    queryKey: ["automation", "registry"],
    queryFn: getAutomationRegistry,
    staleTime: 5 * 60_000,
  });
  const staff = useQuery({ queryKey: ["operations", "staff"], queryFn: getAssignableStaff });

  const save = useMutation({
    mutationFn: (input: AutomationRuleInput) => saveAutomationRule(input),
    onSuccess: () => {
      toast.success("Automation rule saved");
      setDialogOpen(false);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["automation", "rules"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeStatus = useMutation({
    mutationFn: (input: { id: string; status: "active" | "paused" | "archived" }) =>
      setAutomationRuleStatus(input.id, input.status),
    onSuccess: () => {
      toast.success("Rule status updated");
      setArchiving(null);
      void queryClient.invalidateQueries({ queryKey: ["automation", "rules"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const columns: Column<AutomationRule>[] = [
    {
      key: "name",
      header: "Rule",
      render: (rule) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground">{rule.name}</div>
          {rule.description && (
            <div className="truncate text-[12px] text-muted-foreground">{rule.description}</div>
          )}
        </div>
      ),
    },
    {
      key: "trigger",
      header: "Trigger",
      render: (rule) => <span className="font-mono text-[12px]">{rule.trigger_type}</span>,
    },
    {
      key: "conditions",
      header: "Conditions",
      render: (rule) =>
        rule.conditions.length === 0 ? (
          <span className="text-muted-foreground">Always</span>
        ) : (
          <div className="space-y-0.5">
            <div className="text-[11px] uppercase text-muted-foreground">
              match {rule.condition_mode}
            </div>
            {rule.conditions.map((condition, index) => (
              <div key={index} className="text-[12px]">
                {describeCondition(condition)}
              </div>
            ))}
          </div>
        ),
    },
    {
      key: "action",
      header: "Action",
      render: (rule) => <span>{describeAction(rule.action_type, rule.action_config)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (rule) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={AUTOMATION_STATUS_TONE[rule.status]}>{rule.status}</StatusBadge>
          <StatusBadge>{rule.priority}</StatusBadge>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (rule) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(rule);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                changeStatus.mutate({
                  id: rule.id,
                  status: rule.status === "active" ? "paused" : "active",
                })
              }
            >
              {rule.status === "active" ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setArchiving(rule)}>
              <Archive className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Automation Rules"
        description="Rules run synchronously after an authoritative event is recorded. Every run is logged and existing workflow validation still applies."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link to="/automation/executions">
                <History className="mr-1 h-3.5 w-3.5" /> History
              </Link>
            </Button>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> New rule
              </Button>
            )}
          </>
        }
      />

      <div className="rounded border border-border">
        <DataTable
          columns={columns}
          rows={rules.data ?? []}
          rowKey={(rule) => rule.id}
          isLoading={rules.isLoading}
          emptyTitle="No automation rules yet"
          emptyDescription="Create a rule to react automatically to verification, fulfillment, shipping, inventory or procurement events."
        />
      </div>

      <AutomationRuleDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        registry={registry.data}
        staff={staff.data ?? []}
        rule={editing}
        isSaving={save.isPending}
        onSubmit={(input) => save.mutate(input)}
      />

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title="Archive this rule?"
        description="Archived rules stop running and can no longer be edited. Their execution history is kept."
        confirmLabel="Archive"
        onConfirm={() => archiving && changeStatus.mutate({ id: archiving.id, status: "archived" })}
      />
    </div>
  );
}
