import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plug, ExternalLink, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getIntegrationAccounts,
  getIntegrationProviders,
  getIntegrationWebhookOverview,
  formatDateTime,
  webhookEndpointPath,
} from "@/lib/integrations";
import { getIntegrationProvider, listIntegrationProviders, PLANNED_PROVIDERS } from "@/lib/integrations-registry";
import {
  INTEGRATION_CAPABILITY_LABELS,
  INTEGRATION_CATEGORY_LABELS,
  INTEGRATION_CONNECTION_LABELS,
  INTEGRATION_CONNECTION_TONE,
} from "@/types/integrations";
import type { IntegrationAccount, IntegrationCategory } from "@/types/integrations";

const TITLE = "Integrations · Commerce Operations";
const DESCRIPTION =
  "Central place to see every external service this business depends on, what it can do, and whether it is working.";

export const Route = createFileRoute("/_authenticated/integrations/")({
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
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const providers = useQuery({
    queryKey: ["integrations", "providers"],
    queryFn: getIntegrationProviders,
  });
  const accounts = useQuery({
    queryKey: ["integrations", "accounts"],
    queryFn: getIntegrationAccounts,
  });
  const webhooks = useQuery({
    queryKey: ["integrations", "webhooks"],
    queryFn: getIntegrationWebhookOverview,
  });

  const loading = providers.isLoading || accounts.isLoading;

  const byCategory = new Map<IntegrationCategory, IntegrationAccount[]>();
  for (const account of accounts.data ?? []) {
    const list = byCategory.get(account.category) ?? [];
    list.push(account);
    byCategory.set(account.category, list);
  }

  const configuredProviderKeys = new Set((providers.data ?? []).map((p) => p.code));
  const unconnected = listIntegrationProviders().filter(
    (definition) =>
      configuredProviderKeys.has(definition.providerKey) &&
      !(accounts.data ?? []).some((a) => a.providerKey === definition.providerKey),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Providers, connected accounts, capabilities and connection health. Operational records stay owned by their own modules."
        actions={
          <Link
            to="/integrations/logs"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <ExternalLink className="h-4 w-4" /> Activity log
          </Link>
        }
      />

      {loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          {[...byCategory.entries()].map(([category, list]) => (
            <section key={category} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {INTEGRATION_CATEGORY_LABELS[category]}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((account) => {
                  const hook = (webhooks.data ?? []).find((w) => w.account_id === account.id);
                  return (
                    <Card key={account.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <CardTitle className="text-base">{account.providerName}</CardTitle>
                            <p className="text-xs text-muted-foreground">{account.name}</p>
                          </div>
                          <StatusBadge tone={INTEGRATION_CONNECTION_TONE[account.connection]}>
                            {INTEGRATION_CONNECTION_LABELS[account.connection]}
                          </StatusBadge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge tone={account.environment === "production" ? "info" : "neutral"}>
                            {account.environment}
                          </StatusBadge>
                          {account.isDefault ? <StatusBadge tone="info">Default</StatusBadge> : null}
                          {!account.hasAdapter ? (
                            <StatusBadge tone="warning">Manual only</StatusBadge>
                          ) : null}
                        </div>
                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                          {account.capabilities.map((capability) => (
                            <li key={capability}>• {INTEGRATION_CAPABILITY_LABELS[capability]}</li>
                          ))}
                        </ul>
                        <p className="text-xs text-muted-foreground">
                          Last webhook: {formatDateTime(hook?.last_received_at ?? null)}
                        </p>
                        <Link
                          to="/integrations/couriers/$id"
                          params={{ id: account.id }}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Open workspace <ExternalLink className="h-3 w-3" />
                        </Link>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}

          {accounts.data?.length === 0 ? (
            <EmptyState
              title="No integration accounts"
              description="Courier providers exist, but no account has been configured yet."
            />
          ) : null}

          {unconnected.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Available, not connected</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {unconnected.map((definition) => (
                  <Card key={definition.providerKey}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{definition.name}</CardTitle>
                        <StatusBadge tone="neutral">Not connected</StatusBadge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      <p>{definition.note ?? "No account configured."}</p>
                      <p>
                        Webhook endpoint:{" "}
                        <code className="rounded bg-muted px-1">
                          {webhookEndpointPath(definition.providerKey)}
                        </code>
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Planned categories</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {PLANNED_PROVIDERS.map((definition) => (
                <Card key={definition.providerKey} className="opacity-80">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm">{definition.name}</CardTitle>
                      <StatusBadge tone="neutral">Planned</StatusBadge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {definition.note}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4" /> Security model
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p>Credentials are stored server-side and are never readable from this dashboard.</p>
              <p>Connection tests, state changes and refreshes run through permission-checked server actions.</p>
              <p>Webhook endpoints require a shared secret before any event is processed.</p>
            </CardContent>
          </Card>
        </>
      )}

      {providers.data?.length === 0 ? (
        <EmptyState
          title="No providers"
          description="No integration provider is registered yet."
          icon={Plug}
        />
      ) : null}
    </div>
  );
}

export { getIntegrationProvider };
