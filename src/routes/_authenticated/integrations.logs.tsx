import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatDateTime,
  getIntegrationAccounts,
  getIntegrationActivity,
} from "@/lib/integrations";
import {
  INTEGRATION_ACTIVITY_LABELS,
  INTEGRATION_ACTIVITY_TONE,
} from "@/types/integrations";
import type { IntegrationActivityEntry } from "@/types/integrations";

const TITLE = "Integration Activity · Commerce Operations";
const DESCRIPTION =
  "Sanitized history of every integration call, webhook and account change, with no credentials or raw payloads.";
const PAGE_SIZE = 25;

export const Route = createFileRoute("/_authenticated/integrations/logs")({
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
  component: IntegrationLogsPage,
});

function IntegrationLogsPage() {
  const [accountId, setAccountId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(0);

  const accounts = useQuery({
    queryKey: ["integrations", "accounts"],
    queryFn: getIntegrationAccounts,
  });

  const activity = useQuery({
    queryKey: ["integrations", "activity", accountId, status, page],
    queryFn: () =>
      getIntegrationActivity({
        accountId: accountId === "all" ? null : accountId,
        status: status === "all" ? null : status,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const total = activity.data?.total ?? 0;
  const rows = activity.data?.rows ?? [];
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const columns: Column<IntegrationActivityEntry>[] = [
    {
      key: "when",
      header: "When",
      render: (row) => <span className="text-xs">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: "provider",
      header: "Provider / Account",
      render: (row) => (
        <div className="text-xs">
          <div className="font-medium">{row.provider_name ?? "—"}</div>
          <div className="text-muted-foreground">
            {row.account_name ?? "—"}
            {row.environment ? ` · ${row.environment}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Activity",
      render: (row) => (
        <span className="text-xs">
          {INTEGRATION_ACTIVITY_LABELS[row.activity_type] ?? row.activity_type}
        </span>
      ),
    },
    {
      key: "status",
      header: "Result",
      render: (row) => (
        <StatusBadge tone={INTEGRATION_ACTIVITY_TONE[row.status] ?? "neutral"}>
          {row.status}
        </StatusBadge>
      ),
    },
    {
      key: "message",
      header: "Detail",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{row.message ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integration activity"
        description="Read-only history combining provider API calls and inbound webhook events. Entries are sanitized and cannot be edited."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={accountId}
          onValueChange={(value) => {
            setAccountId(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {(accounts.data ?? []).map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.providerName} · {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Any result" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any result</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={activity.isLoading}
        emptyTitle="No integration activity"
        emptyDescription="Nothing has been recorded for the selected filters."
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total === 0 ? "0 entries" : `Page ${page + 1} of ${maxPage + 1} · ${total} entries`}
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
            disabled={page >= maxPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
