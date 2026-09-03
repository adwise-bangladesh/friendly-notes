import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, KeyRound, Plug, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ChannelCredentialsDialog } from "@/components/stores/ChannelCredentialsDialog";
import { useCommercePermissions } from "@/hooks/use-permissions";
import {
  getCredentialStatus,
  getMappings,
  getStore,
  getStoreChannels,
  getSyncRuns,
  saveChannel,
  setChannelStatus,
  activateChannel,
  setStoreStatus,
} from "@/lib/stores";
import { syncChannelOrders, testChannelConnection } from "@/lib/stores.functions";
import {
  AVAILABLE_PROVIDERS,
  CHANNEL_STATUS_LABELS,
  PROVIDER_LABELS,
  STORE_STATUS_LABELS,
  SYNC_STATUS_LABELS,
  SYNC_TYPE_LABELS,
  capabilitiesForProvider,
} from "@/types/stores";
import type {
  SalesChannelAccount,
  SalesChannelProvider,
  SalesChannelStatus,
  StoreStatus,
  SyncStatus,
} from "@/types/stores";
import type { StatusTone } from "@/components/shared/StatusBadge";

const TITLE = "Store detail · Commerce Operations";
const DESCRIPTION = "Sales channels, connection state and import history for this store.";

export const Route = createFileRoute("/_authenticated/stores/$id")({
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

const STORE_TONE: Record<StoreStatus, StatusTone> = {
  active: "success",
  inactive: "warning",
  archived: "danger",
};

const CHANNEL_TONE: Record<SalesChannelStatus, StatusTone> = {
  active: "success",
  disabled: "neutral",
  error: "danger",
  disconnected: "warning",
};

const RUN_TONE: Record<SyncStatus, StatusTone> = {
  pending: "neutral",
  running: "info",
  completed: "success",
  failed: "danger",
  partial: "warning",
};

function Page() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const perms = useCommercePermissions();
  const testConnection = useServerFn(testChannelConnection);
  const syncOrders = useServerFn(syncChannelOrders);

  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [credentialsFor, setCredentialsFor] = useState<string | null>(null);
  const [channelForm, setChannelForm] = useState<{ name: string; provider: SalesChannelProvider }>({
    name: "",
    provider: "woocommerce",
  });

  const storeQuery = useQuery({ queryKey: ["store", id], queryFn: () => getStore(id) });
  const channelsQuery = useQuery({
    queryKey: ["store-channels", id],
    queryFn: () => getStoreChannels(id),
  });

  const accountIds = useMemo(
    () => (channelsQuery.data ?? []).map((channel) => channel.id),
    [channelsQuery.data],
  );

  const runsQuery = useQuery({
    queryKey: ["store-runs", accountIds],
    queryFn: () => getSyncRuns(accountIds),
    enabled: accountIds.length > 0,
  });
  const mappingsQuery = useQuery({
    queryKey: ["store-mappings", accountIds],
    queryFn: () => getMappings(accountIds),
    enabled: accountIds.length > 0,
  });

  const credentialQueries = useQueries({
    queries: (channelsQuery.data ?? [])
      .filter((channel) => channel.provider !== "manual")
      .map((channel) => ({
        queryKey: ["channel-credentials", channel.id],
        queryFn: () => getCredentialStatus(channel.id),
      })),
  });
  const credentialByAccount = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getCredentialStatus> extends Promise<infer T> ? T : never>();
    (channelsQuery.data ?? [])
      .filter((channel) => channel.provider !== "manual")
      .forEach((channel, index) => {
        const result = credentialQueries[index]?.data;
        if (result) map.set(channel.id, result);
      });
    return map;
  }, [channelsQuery.data, credentialQueries]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["store-channels", id] });
    void qc.invalidateQueries({ queryKey: ["store-runs"] });
    void qc.invalidateQueries({ queryKey: ["channel-credentials"] });
    void qc.invalidateQueries({ queryKey: ["stores"] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: StoreStatus) => setStoreStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["store", id] });
      void qc.invalidateQueries({ queryKey: ["stores"] });
      toast.success("Store status updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  const createChannelMutation = useMutation({
    mutationFn: () =>
      saveChannel({
        store_id: id,
        name: channelForm.name.trim(),
        provider: channelForm.provider,
      }),
    onSuccess: () => {
      setChannelDialogOpen(false);
      setChannelForm({ name: "", provider: "woocommerce" });
      refresh();
      toast.success("Sales channel added");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add channel."),
  });

  const channelStatusMutation = useMutation({
    // Activation is an explicit, validated action: the database refuses to
    // activate a channel without credentials or with an inactive store, so the
    // operator never ends up with a channel that silently queues nothing.
    mutationFn: (input: { accountId: string; status: SalesChannelStatus }) =>
      input.status === "active"
        ? activateChannel(input.accountId)
        : setChannelStatus(input.accountId, input.status),
    onSuccess: () => {
      refresh();
      toast.success("Channel updated");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Update failed."),
  });

  const testMutation = useMutation({
    mutationFn: (accountId: string) => testConnection({ data: { accountId } }),
    onSuccess: (result) => {
      refresh();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Connection test failed."),
  });

  const syncMutation = useMutation({
    mutationFn: (accountId: string) => syncOrders({ data: { accountId, limit: 20 } }),
    onSuccess: (result) => {
      refresh();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });

  const store = storeQuery.data;

  if (storeQuery.isLoading) return <LoadingState rows={4} label="Loading store" />;
  if (!store) {
    return (
      <EmptyState
        icon={Plug}
        title="Store not found"
        description="This store may have been removed."
        action={
          <Button size="sm" asChild>
            <Link to="/stores">Back to stores</Link>
          </Button>
        }
      />
    );
  }

  const busy = testMutation.isPending || syncMutation.isPending;

  return (
    <>
      <PageHeader
        title={store.name}
        description={`${store.code} · ${store.currency} · ${store.timezone} · ${store.country}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/stores">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Stores
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/stores/$id/catalog" params={{ id }}>
                Catalog
              </Link>
            </Button>
            {perms.canArchive ? (
              <Select
                value={store.status}
                onValueChange={(value) => statusMutation.mutate(value as StoreStatus)}
              >
                <SelectTrigger className="h-8 w-36 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STORE_STATUS_LABELS) as StoreStatus[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {STORE_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <StatusBadge tone={STORE_TONE[store.status]}>
                {STORE_STATUS_LABELS[store.status]}
              </StatusBadge>
            )}
          </div>
        }
      />

      <Tabs defaultValue="channels">
        <TabsList>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="history">Sync history</TabsTrigger>
          <TabsTrigger value="mappings">Mappings</TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="space-y-3">
          <div className="flex justify-end">
            {perms.canManage ? (
              <Button size="sm" onClick={() => setChannelDialogOpen(true)}>
                <Plug className="mr-1.5 h-3.5 w-3.5" />
                Add channel
              </Button>
            ) : null}
          </div>

          {channelsQuery.isLoading ? (
            <LoadingState rows={2} label="Loading channels" />
          ) : (channelsQuery.data ?? []).length === 0 ? (
            <EmptyState icon={Plug} title="No channels" description="Add a sales channel to this store." />
          ) : (
            <div className="grid gap-3">
              {(channelsQuery.data ?? []).map((channel: SalesChannelAccount) => {
                const capabilities = capabilitiesForProvider(channel.provider);
                const canTest = capabilities.some((c) => c.key === "test_connection" && c.supported);
                const canSync = capabilities.some((c) => c.key === "sync_orders" && c.supported);
                const credentials = credentialByAccount.get(channel.id);
                return (
                  <div key={channel.id} className="rounded-md border border-border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium">{channel.name}</span>
                          <StatusBadge tone={CHANNEL_TONE[channel.status]}>
                            {CHANNEL_STATUS_LABELS[channel.status]}
                          </StatusBadge>
                        </div>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {PROVIDER_LABELS[channel.provider]}
                          {channel.external_store_name ? ` · ${channel.external_store_name}` : ""}
                          {channel.last_successful_sync_at
                            ? ` · last import ${new Date(channel.last_successful_sync_at).toLocaleString()}`
                            : " · never imported"}
                        </p>
                        {channel.last_error ? (
                          <p className="mt-1 text-[12px] text-destructive">{channel.last_error}</p>
                        ) : null}
                        {channel.provider !== "manual" ? (
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {credentials?.configured
                              ? `Credentials stored${credentials.site_url ? ` for ${credentials.site_url}` : ""}`
                              : "No credentials configured"}
                          </p>
                        ) : (
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            Orders on this channel are created inside Commerce Operations.
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {perms.canArchive && channel.provider !== "manual" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCredentialsFor(channel.id)}
                          >
                            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                            Credentials
                          </Button>
                        ) : null}
                        {perms.canManage && canTest ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => testMutation.mutate(channel.id)}
                          >
                            Test connection
                          </Button>
                        ) : null}
                        {perms.canManage && canSync ? (
                          <Button
                            size="sm"
                            disabled={busy || channel.status === "disabled"}
                            onClick={() => syncMutation.mutate(channel.id)}
                          >
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            Import orders
                          </Button>
                        ) : null}
                        {perms.canManage && channel.provider !== "manual" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              channelStatusMutation.mutate({
                                accountId: channel.id,
                                status: channel.status === "disabled" ? "disconnected" : "disabled",
                              })
                            }
                          >
                            {channel.status === "disabled" ? "Enable" : "Disable"}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-[12px] text-muted-foreground">
                      {capabilities.map((capability) => (
                        <span key={capability.key}>
                          {capability.supported ? "✓" : "—"} {capability.label}
                          {capability.note ? ` (${capability.note})` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <div className="rounded-md border border-border bg-card">
            {runsQuery.isLoading ? (
              <LoadingState rows={3} label="Loading history" />
            ) : (runsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon={RefreshCw}
                title="No imports yet"
                description="Every import run is recorded here with its counts and outcome."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left font-semibold">Started</th>
                      <th className="px-3 py-2 text-left font-semibold">Type</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Fetched</th>
                      <th className="px-3 py-2 text-right font-semibold">Created</th>
                      <th className="px-3 py-2 text-right font-semibold">Skipped</th>
                      <th className="px-3 py-2 text-right font-semibold">Failed</th>
                      <th className="px-3 py-2 text-left font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(runsQuery.data ?? []).map((run) => (
                      <tr key={run.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5">{new Date(run.started_at).toLocaleString()}</td>
                        <td className="px-3 py-1.5">{SYNC_TYPE_LABELS[run.sync_type]}</td>
                        <td className="px-3 py-1.5">
                          <StatusBadge tone={RUN_TONE[run.status]}>
                            {SYNC_STATUS_LABELS[run.status]}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{run.records_fetched}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{run.records_created}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{run.records_skipped}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{run.records_failed}</td>
                        <td className="whitespace-pre-line px-3 py-1.5 text-[12px] text-muted-foreground">
                          {run.error_summary ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="mappings">
          <div className="rounded-md border border-border bg-card">
            {mappingsQuery.isLoading ? (
              <LoadingState rows={3} label="Loading mappings" />
            ) : (mappingsQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon={Plug}
                title="No external mappings"
                description="Mappings link an external record to the internal one, and make imports idempotent."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left font-semibold">Type</th>
                      <th className="px-3 py-2 text-left font-semibold">External ID</th>
                      <th className="px-3 py-2 text-left font-semibold">Reference</th>
                      <th className="px-3 py-2 text-left font-semibold">Internal ID</th>
                      <th className="px-3 py-2 text-left font-semibold">Linked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mappingsQuery.data ?? []).map((mapping) => (
                      <tr key={mapping.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5">{mapping.entity_type}</td>
                        <td className="px-3 py-1.5 font-mono text-[12px]">{mapping.external_id}</td>
                        <td className="px-3 py-1.5">{mapping.external_reference ?? "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-[12px]">{mapping.internal_id}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {new Date(mapping.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add sales channel</DialogTitle>
            <DialogDescription>
              Only Manual and WooCommerce are implemented today. Other providers come in later steps.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                value={channelForm.name}
                onChange={(e) => setChannelForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Main WooCommerce site"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select
                value={channelForm.provider}
                onValueChange={(value) =>
                  setChannelForm((prev) => ({ ...prev, provider: value as SalesChannelProvider }))
                }
              >
                <SelectTrigger className="text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_PROVIDERS.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setChannelDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!channelForm.name.trim() || createChannelMutation.isPending}
              onClick={() => createChannelMutation.mutate()}
            >
              Add channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {credentialsFor ? (
        <ChannelCredentialsDialog
          accountId={credentialsFor}
          status={credentialByAccount.get(credentialsFor)}
          open={credentialsFor !== null}
          onOpenChange={(open) => {
            if (!open) setCredentialsFor(null);
          }}
          onSaved={refresh}
        />
      ) : null}
    </>
  );
}
