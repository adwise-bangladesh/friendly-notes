/**
 * Store & sales channel server operations.
 *
 * Everything that touches provider credentials happens here, on the server.
 * The browser never receives a key, a secret or a raw provider response.
 *
 * The order import deliberately reuses the authoritative paths:
 *   create_order  → totals, snapshots, verification defaults, history
 *   resolve_customer_for_order (inside create_order) → phone normalisation,
 *   duplicate reuse and the blocked-customer rule
 *   upsert_external_mapping → idempotency, enforced by a unique index
 * Nothing here writes an order, customer or product row directly.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SalesChannelError } from "./sales-channels/adapter";
import type { NormalizedExternalOrder } from "./sales-channels/adapter";

const accountInput = z.object({ accountId: z.string().uuid() });
const credentialsInput = z.object({
  accountId: z.string().uuid(),
  siteUrl: z.string().min(1).max(300),
  consumerKey: z.string().min(1).max(300),
  consumerSecret: z.string().min(1).max(300),
  apiVersion: z.string().min(1).max(20).default("wc/v3"),
});
const syncInput = z.object({ accountId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20) });

export interface ChannelActionResult {
  ok: boolean;
  message: string;
}

export interface SyncResult extends ChannelActionResult {
  runId: string | null;
  fetched: number;
  created: number;
  skipped: number;
  failed: number;
  reasons: string[];
}

type MinimalClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function assertCanManage(supabase: unknown, userId: string) {
  const client = supabase as MinimalClient;
  const { data } = await client.rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to manage sales channels");
}

async function assertIsAdmin(supabase: unknown, userId: string) {
  const client = supabase as MinimalClient;
  const { data } = await client.rpc("is_admin", { _user_id: userId });
  if (data !== true) throw new Error("Only an administrator can perform this action");
}

/** Sanitised: provider bodies and credentials never reach the message. */
function safeMessage(error: unknown): string {
  if (error instanceof SalesChannelError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 300);
  return "The operation failed";
}

async function loadAccount(accountId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("sales_channel_accounts")
    .select("id, store_id, provider, name, status")
    .eq("id", accountId)
    .maybeSingle();
  if (!data) throw new Error("Sales channel not found");
  return data;
}

/** Stores the credentials through the controlled function. Nothing is returned. */
export const saveChannelCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => credentialsInput.parse(input))
  .handler(async ({ data, context }): Promise<ChannelActionResult> => {
    await assertIsAdmin(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);
    if (account.provider !== "woocommerce") {
      return { ok: false, message: "This channel does not use API credentials" };
    }
    const client = context.supabase as unknown as MinimalClient;
    const { error } = await client.rpc("set_sales_channel_credentials", {
      _account_id: data.accountId,
      _site_url: data.siteUrl,
      _consumer_key: data.consumerKey,
      _consumer_secret: data.consumerSecret,
      _api_version: data.apiVersion,
    });
    if (error) throw new Error(error.message);
    return { ok: true, message: "Credentials saved. They are stored server-side and never shown again." };
  });

/** Minimal authenticated round-trip against the provider. */
export const testChannelConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => accountInput.parse(input))
  .handler(async ({ data, context }): Promise<ChannelActionResult> => {
    await assertCanManage(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);
    const { getSalesChannelAdapter, loadCredentials } = await import("./sales-channels/registry.server");
    const adapter = getSalesChannelAdapter(account.provider);
    const client = context.supabase as unknown as MinimalClient;

    if (!adapter) {
      return { ok: false, message: "This channel has no external API to test" };
    }
    const credentials = await loadCredentials(data.accountId);
    if (!credentials) {
      await client.rpc("set_sales_channel_account_state", {
        _account_id: data.accountId,
        _status: "disconnected",
        _error: "No credentials configured",
      });
      return { ok: false, message: "No credentials are configured for this connection yet" };
    }

    const result = await adapter.testConnection(credentials);
    await client.rpc("set_sales_channel_account_state", {
      _account_id: data.accountId,
      _status: result.ok ? "active" : "error",
      _error: result.ok ? null : result.message,
    });
    if (result.ok && result.info) {
      await client.rpc("save_sales_channel_account", {
        _payload: {
          id: data.accountId,
          external_store_id: result.info.external_store_id,
          external_store_name: result.info.external_store_name,
        },
      });
    }
    return { ok: result.ok, message: result.message };
  });

interface ImportOutcome {
  outcome: "created" | "skipped" | "failed";
  reason?: string;
}

/**
 * FETCH → NORMALIZE → VALIDATE → DEDUPLICATE → MAP → CONTROLLED CREATE → RECORD.
 * A missing product mapping is skipped with a reason; it is never guessed.
 */
async function importOrder(
  client: MinimalClient,
  accountId: string,
  storeId: string,
  order: NormalizedExternalOrder,
): Promise<ImportOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // VALIDATE
  if (!order.customer_phone.trim()) return { outcome: "failed", reason: `Order ${order.external_id}: no customer phone` };
  if (order.lines.length === 0) return { outcome: "skipped", reason: `Order ${order.external_id}: no line items` };

  // DEDUPLICATE — the unique index is the real guard, this only avoids the work
  const { data: existing } = await supabaseAdmin
    .from("external_entity_mappings")
    .select("id")
    .eq("sales_channel_account_id", accountId)
    .eq("entity_type", "order")
    .eq("external_id", order.external_id)
    .maybeSingle();
  if (existing) return { outcome: "skipped", reason: `Order ${order.external_id}: already imported` };

  // MAP products / variants — no guessing
  const items: { product_id: string; variant_id?: string; quantity: number }[] = [];
  for (const line of order.lines) {
    const { data: productMap } = await supabaseAdmin
      .from("external_entity_mappings")
      .select("internal_id")
      .eq("sales_channel_account_id", accountId)
      .eq("entity_type", "product")
      .eq("external_id", line.external_product_id)
      .maybeSingle();
    if (!productMap) {
      return {
        outcome: "skipped",
        reason: `Order ${order.external_id}: product ${line.external_product_id} is not mapped`,
      };
    }
    let variantId: string | undefined;
    if (line.external_variant_id) {
      const { data: variantMap } = await supabaseAdmin
        .from("external_entity_mappings")
        .select("internal_id")
        .eq("sales_channel_account_id", accountId)
        .eq("entity_type", "variant")
        .eq("external_id", line.external_variant_id)
        .maybeSingle();
      if (!variantMap) {
        return {
          outcome: "skipped",
          reason: `Order ${order.external_id}: variant ${line.external_variant_id} is not mapped`,
        };
      }
      variantId = variantMap.internal_id;
    }
    items.push({
      product_id: productMap.internal_id,
      ...(variantId ? { variant_id: variantId } : {}),
      quantity: line.quantity,
    });
  }

  // CONTROLLED CREATE — same authoritative path as a manual order
  const { data: created, error: createError } = await client.rpc("create_order", {
    _payload: {
      source: "api",
      customer_name: order.customer_name || "Online customer",
      customer_phone: order.customer_phone,
      customer_email: order.customer_email,
      shipping_charge: order.shipping_charge,
      order_discount: order.discount,
      address: {
        recipient_name: order.customer_name,
        phone: order.customer_phone,
        address_line: order.address_line,
        area: order.area,
        district: order.district,
        postal_code: order.postal_code,
      },
      items,
    },
  });
  if (createError) {
    return { outcome: "failed", reason: `Order ${order.external_id}: ${createError.message.slice(0, 160)}` };
  }
  const internalId = (created as { id?: string } | null)?.id;
  if (!internalId) return { outcome: "failed", reason: `Order ${order.external_id}: order was not created` };

  // MAP + STORE ASSOCIATION
  const { error: mapError } = await client.rpc("upsert_external_mapping", {
    _account_id: accountId,
    _entity_type: "order",
    _internal_id: internalId,
    _external_id: order.external_id,
    _external_reference: order.external_reference,
  });
  if (mapError) return { outcome: "failed", reason: `Order ${order.external_id}: ${mapError.message.slice(0, 160)}` };
  await client.rpc("set_order_store", { _order_id: internalId, _store_id: storeId });

  return { outcome: "created" };
}

/** Manual, user-triggered order import. No background jobs. */
export const syncChannelOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => syncInput.parse(input))
  .handler(async ({ data, context }): Promise<SyncResult> => {
    await assertCanManage(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);
    const client = context.supabase as unknown as MinimalClient;

    const { getSalesChannelAdapter, loadCredentials } = await import("./sales-channels/registry.server");
    const adapter = getSalesChannelAdapter(account.provider);
    if (!adapter) {
      return {
        ok: false, runId: null, fetched: 0, created: 0, skipped: 0, failed: 0, reasons: [],
        message: "This channel has no order import — orders are created inside Commerce Operations",
      };
    }

    const { data: runRow, error: runError } = await client.rpc("start_sync_run", {
      _account_id: data.accountId,
      _sync_type: "orders",
    });
    if (runError) throw new Error(runError.message);
    const runId = (runRow as { id: string }).id;

    let fetched = 0, created = 0, skipped = 0, failed = 0;
    const reasons: string[] = [];
    let fatal: string | null = null;

    try {
      const credentials = await loadCredentials(data.accountId);
      if (!credentials) throw new SalesChannelError("No credentials are configured for this connection");
      const orders = await adapter.fetchOrders(credentials, { limit: data.limit });
      fetched = orders.length;
      for (const order of orders) {
        const result = await importOrder(client, data.accountId, account.store_id, order);
        if (result.outcome === "created") created += 1;
        else if (result.outcome === "skipped") skipped += 1;
        else failed += 1;
        if (result.reason && reasons.length < 20) reasons.push(result.reason);
      }
    } catch (error) {
      fatal = safeMessage(error);
    }

    const status = fatal ? "failed" : failed > 0 ? "partial" : "completed";
    const summary = fatal ?? (reasons.length > 0 ? reasons.join("\n") : null);
    await client.rpc("finish_sync_run", {
      _run_id: runId,
      _status: status,
      _fetched: fetched,
      _created: created,
      _updated: 0,
      _skipped: skipped,
      _failed: failed,
      _error_summary: summary,
    });
    await client.rpc("set_sales_channel_account_state", {
      _account_id: data.accountId,
      _status: fatal ? "error" : "active",
      _error: fatal,
      _touch_sync: true,
      _successful: !fatal,
    });

    return {
      ok: !fatal,
      runId,
      fetched,
      created,
      skipped,
      failed,
      reasons,
      message: fatal ?? `Imported ${created}, skipped ${skipped}, failed ${failed} of ${fetched} orders.`,
    };
  });
