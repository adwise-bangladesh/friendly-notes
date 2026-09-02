import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable";
import { getAutomationExecutions, getAutomationRules } from "@/lib/automation";
import type { AutomationExecution } from "@/types/automation";
import { AUTOMATION_EXECUTION_TONE } from "@/types/automation";

const TITLE = "Automation History · Commerce Operations";
const DESCRIPTION = "Immutable log of every automation rule evaluation and action result.";

export const Route = createFileRoute("/_authenticated/automation/executions")({
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
  component: AutomationHistoryPage,
});

function AutomationHistoryPage() {
  const [ruleId, setRuleId] = useState("all");
  const [status, setStatus] = useState("all");

  const rules = useQuery({
    queryKey: ["automation", "rules", "all"],
    queryFn: () => getAutomationRules(true),
  });

  const executions = useQuery({
    queryKey: ["automation", "executions", ruleId, status],
    queryFn: () =>
      getAutomationExecutions({
        ruleId: ruleId === "all" ? null : ruleId,
        status: status === "all" ? null : status,
        limit: 200,
      }),
  });

  const columns: Column<AutomationExecution>[] = [
    {
      key: "created_at",
      header: "When",
      render: (row) => (
        <span className="whitespace-nowrap text-[12px]">
          {new Date(row.created_at).toLocaleString()}
        </span>
      ),
    },
    { key: "rule", header: "Rule", render: (row) => row.rule_name ?? "—" },
    {
      key: "event",
      header: "Event",
      render: (row) => (
        <div>
          <div className="font-mono text-[12px]">{row.event_type}</div>
          <div className="text-[11px] text-muted-foreground">{row.entity_type}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Result",
      render: (row) => (
        <div className="space-y-0.5">
          <StatusBadge tone={AUTOMATION_EXECUTION_TONE[row.status]}>{row.status}</StatusBadge>
          {row.error_message && (
            <div className="text-[12px] text-destructive">{row.error_message}</div>
          )}
          {row.result && (
            <div className="text-[12px] text-muted-foreground">
              {JSON.stringify(row.result)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "depth",
      header: "Depth",
      align: "right",
      render: (row) => row.automation_depth,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Automation History"
        description="Every evaluation is recorded once per source event. History cannot be edited or deleted."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/automation">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Rules
            </Link>
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={ruleId} onValueChange={setRuleId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="All rules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All rules</SelectItem>
            {(rules.data ?? []).map((rule) => (
              <SelectItem key={rule.id} value={rule.id}>
                {rule.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All results" />
          </SelectTrigger>
          <SelectContent>
            {["all", "completed", "skipped", "failed", "running", "pending"].map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All results" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded border border-border">
        <DataTable
          columns={columns}
          rows={executions.data ?? []}
          rowKey={(row) => row.id}
          isLoading={executions.isLoading}
          emptyTitle="No automation runs yet"
          emptyDescription="Runs appear here as soon as a matching operational event occurs."
        />
      </div>
    </div>
  );
}
