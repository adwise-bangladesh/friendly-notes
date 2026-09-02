import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, PlugZap, Power, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTable } from "@/components/shared/DataTable";
import type { Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  deriveConnectionStatus,
  formatDateTime,
  getIntegrationAccount,
  getIntegrationAccountHealth,
  getIntegrationActivity,
  getIntegrationWebhookOverview,
  webhookEndpointPath,
} from "@/lib/integrations";
import { getIntegrationProvider } from "@/lib/integrations-registry";
import {
  refreshIntegrationLocations,
  setIntegrationAccountState,
  testIntegrationConnection,
} from "@/lib/integrations.functions";
import {
  INTEGRATION_ACTIVITY_LABELS,
  INTEGRATION_ACTIVITY_TONE,
  INTEGRATION_CAPABILITY_LABELS,
  INTEGRATION_CONNECTION_LABELS,
  INTEGRATION_CONNECTION_TONE,
} from "@/types/integrations";
import type { IntegrationActivityEntry } from "@/types/integrations";

const TITLE = "Courier Integration · Commerce Operations";
const DESCRIPTION =
  "Configuration, capabilities, connection health and recent activity for one courier integration account.";

export const Route = createFileRoute("/_authenticated/integrations/couriers/$id")({
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
  component: CourierIntegrationPage,
});

function CourierIntegrationPage() {
  const { id } = useParams({ from: "/_authenticated/integrations/couriers/$id" });
  const queryClient = useQueryClient();
  const { canManage } = useCommercePermissions();

  const testConnection = useServerFn(testIntegrationConnection);
  const setState = useServerFn(setIntegrationAccountState);
  const refreshLocations = useServerFn(refreshIntegrationLocations);

  const account = useQuery({
    queryKey: ["integrations", "account", id],
    queryFn: () => getIntegrationAccount(id),
  });
  const health = useQuery({
    queryKey: ["integrations", "health", id],
    queryFn: () => getIntegrationAccountHealth(id),
  });
  const webhooks = useQuery({
    queryKey: ["integrations", "webhooks"],
    queryFn: getIntegrationWebhookOverview,
  });
  const activity = useQuery({
    queryKey: ["integrations", "activity", "account", id],
    queryFn: () => getIntegrationActivity({ accountId: id, limit: 20 }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const test = useMutation({
    mutationFn: () => testConnection({ data: { accountId: id } }),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refresh = useMutation({
    mutationFn: () => refreshLocations({ data: { accountId: id } }),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: (status: "active" | "disabled") => setState({ data: { accountId: id, status } }),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (account.isLoading) return <LoadingState rows={6} />;
  if (!account.data) {
    return (
      <EmptyState
        title="Integration account not found"
        description="This account no longer exists."
      />
    );
  }

  const data = account.data;
  const definition = getIntegrationProvider(data.providerKey);
  const connection = deriveConnectionStatus({
    accountStatus: data.accountStatus,
    hasAdapter: data.hasAdapter,
    health: health.data ?? null,
  });
  const hook = (webhooks.data ?? []).find((w) => w.account_id === data.id);
  const isEnabled = data.accountStatus === "active";

  const columns: Column<IntegrationActivityEntry>[] = [
    {
      key: "when",
      header: "When",
      render: (row) => <span className="text-xs">{formatDateTime(row.created_at)}</span>,
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
      <Link
        to="/integrations"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Back to integrations
      </Link>

      <PageHeader
        title={`${data.providerName} · ${data.name}`}
        description="Courier integration account. Shipment records stay owned by the shipping module."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!data.hasAdapter || !isEnabled || test.isPending}
                onClick={() => test.mutate()}
              >
                <PlugZap className="mr-2 h-4 w-4" />
                {test.isPending ? "Testing…" : "Test connection"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data.hasAdapter || !isEnabled || refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh locations
              </Button>
              <Button
                variant={isEnabled ? "outline" : "default"}
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(isEnabled ? "disabled" : "active")}
              >
                <Power className="mr-2 h-4 w-4" />
                {isEnabled ? "Disable" : "Enable"}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge tone={INTEGRATION_CONNECTION_TONE[connection]}>
                {INTEGRATION_CONNECTION_LABELS[connection]}
              </StatusBadge>
              <StatusBadge tone={data.environment === "production" ? "info" : "neutral"}>
                {data.environment}
              </StatusBadge>
              {data.isDefault ? <StatusBadge tone="info">Default</StatusBadge> : null}
            </div>
            <Row label="Account code" value={data.code} />
            <Row label="Store ID" value={data.externalStoreId ?? "—"} />
            <Row
              label="Credentials"
              value={health.data?.has_credentials ? "Stored (server-side)" : "Not configured"}
            />
            <Row label="Last success" value={formatDateTime(health.data?.last_success_at)} />
            <Row label="Last failure" value={formatDateTime(health.data?.last_failure_at)} />
            {health.data?.last_failure_message ? (
              <p className="text-xs text-destructive">{health.data.last_failure_message}</p>
            ) : null}
            <Row
              label="Failures (24h)"
              value={String(health.data?.failure_count_24h ?? 0)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Capabilities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.capabilities.map((capability) => (
                <li key={capability}>• {INTEGRATION_CAPABILITY_LABELS[capability]}</li>
              ))}
            </ul>
            {!data.hasAdapter ? (
              <p className="text-xs text-warning-foreground">
                No API adapter exists for this provider — shipments are handled manually.
              </p>
            ) : null}
            {definition?.accountRequirements.length ? (
              <p className="text-xs text-muted-foreground">
                Requires: {definition.accountRequirements.join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Webhook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="break-all text-xs">
              <code className="rounded bg-muted px-1">
                {webhookEndpointPath(data.providerKey)}
              </code>
            </p>
            <Row
              label="Shared secret"
              value={health.data?.has_webhook_secret ? "Configured" : "Not configured"}
            />
            <Row label="Last received" value={formatDateTime(hook?.last_received_at ?? null)} />
            <Row label="Applied events" value={String(hook?.applied_count ?? 0)} />
            <Row label="Duplicates" value={String(hook?.duplicate_count ?? 0)} />
            <Row label="Rejected" value={String(hook?.rejected_count ?? 0)} />
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Recent activity</h2>
        <DataTable
          columns={columns}
          rows={activity.data?.rows ?? []}
          rowKey={(row) => row.id}
          isLoading={activity.isLoading}
          emptyTitle="No activity yet"
          emptyDescription="Nothing has been recorded for this account."
        />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
