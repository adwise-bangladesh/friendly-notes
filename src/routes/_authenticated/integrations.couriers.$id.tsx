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
  getIntegrationCredentialStatus,
  getIntegrationStoreOptions,
  getIntegrationAccountHealth,
  getIntegrationActivity,
  getIntegrationWebhookOverview,
  webhookEndpointPath,
} from "@/lib/integrations";
import { getIntegrationProvider } from "@/lib/integrations-registry";
import {
  refreshIntegrationLocations,
  saveIntegrationCredentials,
  setIntegrationAccountScope,
  setIntegrationAccountState,
  testIntegrationConnection,
} from "@/lib/integrations.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import {
  INTEGRATION_ACTIVITY_LABELS,
  INTEGRATION_ACTIVITY_TONE,
  INTEGRATION_CAPABILITY_LABELS,
  INTEGRATION_CONNECTION_LABELS,
  INTEGRATION_CONNECTION_TONE,
} from "@/types/integrations";
import type {
  IntegrationActivityEntry,
  IntegrationCredentialStatus,
} from "@/types/integrations";

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
  const saveScope = useServerFn(setIntegrationAccountScope);
  const saveCredentials = useServerFn(saveIntegrationCredentials);

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
  const credentials = useQuery({
    queryKey: ["integrations", "credentials", id],
    queryFn: () => getIntegrationCredentialStatus(id),
  });
  const stores = useQuery({
    queryKey: ["integrations", "stores"],
    queryFn: getIntegrationStoreOptions,
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

  const scope = useMutation({
    mutationFn: (input: { storeId: string | null; isDefault: boolean }) =>
      saveScope({ data: { accountId: id, ...input } }),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const creds = useMutation({
    mutationFn: (input: {
      clientId?: string;
      username?: string;
      clientSecret?: string;
      password?: string;
      webhookSecret?: string;
    }) => saveCredentials({ data: { accountId: id, ...input } }),
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
            <Row
              label="Scope"
              value={data.scope === "store" ? (data.storeName ?? "One store") : "Organization-wide"}
            />
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

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ScopeCard
            storeId={data.storeId}
            isDefault={data.isDefault}
            stores={stores.data ?? []}
            saving={scope.isPending}
            onSave={(input) => scope.mutate(input)}
          />
          <CredentialsCard
            status={credentials.data ?? null}
            saving={creds.isPending}
            onSave={(input) => creds.mutate(input)}
          />
        </div>
      ) : null}

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

const ORG_SCOPE = "__organization__";

function ScopeCard({
  storeId,
  isDefault,
  stores,
  saving,
  onSave,
}: {
  storeId: string | null;
  isDefault: boolean;
  stores: { id: string; name: string }[];
  saving: boolean;
  onSave: (input: { storeId: string | null; isDefault: boolean }) => void;
}) {
  const [store, setStore] = useState(storeId ?? ORG_SCOPE);
  const [asDefault, setAsDefault] = useState(isDefault);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Account scope</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          A store-scoped account is used only for that store&apos;s orders. Organization-wide
          accounts are the fallback for every other store. Only one active default is allowed per
          courier in each scope.
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">Used by</Label>
          <Select value={store} onValueChange={setStore}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ORG_SCOPE}>Every store (organization-wide)</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Default for this courier in that scope</Label>
          <Switch checked={asDefault} onCheckedChange={setAsDefault} />
        </div>
        <Button
          size="sm"
          disabled={saving}
          onClick={() =>
            onSave({ storeId: store === ORG_SCOPE ? null : store, isDefault: asDefault })
          }
        >
          {saving ? "Saving…" : "Save scope"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CredentialsCard({
  status,
  saving,
  onSave,
}: {
  status: IntegrationCredentialStatus | null;
  saving: boolean;
  onSave: (input: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const fields = [
    { key: "clientId", label: "Client ID", secret: false, configured: status?.has_client_id },
    { key: "username", label: "Username", secret: false, configured: status?.has_username },
    {
      key: "clientSecret",
      label: "Client secret",
      secret: true,
      configured: status?.has_client_secret,
    },
    { key: "password", label: "Password", secret: true, configured: status?.has_password },
    {
      key: "webhookSecret",
      label: "Webhook shared secret",
      secret: true,
      configured: status?.has_webhook_secret,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Credentials</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Secrets are encrypted and never readable again — not by this page, not by any API
          response. Leave a field blank to keep the stored value. Changing a secret clears the
          cached provider token.
        </p>
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{field.label}</Label>
              <span className="text-[11px] text-muted-foreground">
                {field.configured ? "Configured" : "Not set"}
              </span>
            </div>
            <Input
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              placeholder={field.configured ? "Unchanged" : "Not set"}
              value={values[field.key] ?? ""}
              onChange={set(field.key)}
            />
          </div>
        ))}
        <Button
          size="sm"
          disabled={saving || Object.values(values).every((v) => v.trim() === "")}
          onClick={() => {
            const payload: Record<string, string> = {};
            for (const [key, value] of Object.entries(values)) {
              if (value.trim() !== "") payload[key] = value;
            }
            onSave(payload);
            setValues({});
          }}
        >
          {saving ? "Saving…" : "Save credentials"}
        </Button>
      </CardContent>
    </Card>
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
