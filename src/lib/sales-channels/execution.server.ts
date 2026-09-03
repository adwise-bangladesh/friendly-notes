/**
 * Shared listing execution — SERVER ONLY.
 *
 * One code path performs every outbound listing operation, whether it was
 * triggered manually from the UI or claimed from the background queue:
 *
 *   readiness (publish/update only) → controlled BEGIN (row lock + sync run)
 *   → provider call with server-only credentials → controlled FINISH
 *
 * The caller supplies the Supabase client: the signed-in user's client for a
 * manual action, the service-role client for the background worker. Neither
 * writes a listing row directly, and inventory is never mutated.
 */

import { SalesChannelError } from "./adapter";
import type { EffectiveProductData, PublishResult } from "./adapter";
import { OPERATION_CAPABILITY } from "./capabilities";
import type { ListingOperation } from "./capabilities";

export type FailureClass =
  | "transient"
  | "permanent"
  | "rate_limited"
  | "authentication"
  | "unknown";

export interface RpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ExecutionResult {
  ok: boolean;
  message: string;
  runId: string | null;
  listingStatus: string | null;
  externalProductId: string | null;
  externalMissing: boolean;
  failureClass: FailureClass | null;
  /** Provider-requested earliest retry time, when the failure was rate limiting. */
  retryAfter: string | null;
}

function safeMessage(error: unknown): string {
  if (error instanceof SalesChannelError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 300);
  return "The operation failed";
}

/** A database-side refusal is classified so the queue knows whether to retry. */
function classifyControlError(message: string): FailureClass {
  const m = message.toLowerCase();
  if (m.includes("already running")) return "transient";
  if (m.includes("could not obtain lock") || m.includes("deadlock")) return "transient";
  return "permanent";
}

async function loadListingContext(listingId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("sales_channel_product_listings")
    .select("id, store_product_id, sales_channel_account_id, external_product_id, listing_status")
    .eq("id", listingId)
    .maybeSingle();
  if (!data) throw new SalesChannelError("Listing not found");
  const { data: account } = await supabaseAdmin
    .from("sales_channel_accounts")
    .select("id, provider, status, store_id")
    .eq("id", data.sales_channel_account_id)
    .maybeSingle();
  if (!account) throw new SalesChannelError("Sales channel not found");
  return { listing: data, account };
}

export async function executeListingOperation(
  client: RpcClient,
  listingId: string,
  operation: ListingOperation,
): Promise<ExecutionResult> {
  const { listing, account } = await loadListingContext(listingId);

  const { getSalesChannelAdapter, loadCredentials } = await import("./registry.server");
  const adapter = getSalesChannelAdapter(account.provider);
  if (!adapter || !adapter.capabilities.includes(OPERATION_CAPABILITY[operation])) {
    return {
      ok: false,
      message: "This sales channel does not support that operation",
      runId: null,
      listingStatus: listing.listing_status,
      externalProductId: listing.external_product_id,
      externalMissing: false,
      failureClass: "permanent",
      retryAfter: null,
    };
  }

  // Readiness gates the operations that push our data outward.
  if (operation === "listing_publish" || operation === "listing_update") {
    const { data: readiness, error: readinessError } = await client.rpc("channel_listing_readiness", {
      _listing_id: listingId,
    });
    if (readinessError) throw new Error(readinessError.message);
    const parsed = readiness as { ready?: boolean; blocking?: string[] } | null;
    if (!parsed?.ready) {
      return {
        ok: false,
        message: `Not ready to publish: ${(parsed?.blocking ?? ["unknown reason"]).join("; ")}`,
        runId: null,
        listingStatus: listing.listing_status,
        externalProductId: listing.external_product_id,
        externalMissing: false,
        failureClass: "permanent",
        retryAfter: null,
      };
    }
  }

  // CONTROLLED BEGIN — row lock + state transition + sync run
  const { data: begun, error: beginError } = await client.rpc("begin_listing_operation", {
    _listing_id: listingId,
    _operation: operation,
  });
  if (beginError) {
    return {
      ok: false,
      message: beginError.message,
      runId: null,
      listingStatus: listing.listing_status,
      externalProductId: listing.external_product_id,
      externalMissing: false,
      failureClass: classifyControlError(beginError.message),
      retryAfter: null,
    };
  }
  const runId = (begun as { run_id: string }).run_id;

  let result: PublishResult;
  try {
    const credentials = await loadCredentials(account.id);
    if (!credentials) throw new SalesChannelError("No credentials are configured for this connection");

    // Authoritative effective data is resolved in the database, once.
    const { data: effective, error: effectiveError } = await client.rpc(
      "effective_store_product_data",
      { _store_product_id: listing.store_product_id },
    );
    if (effectiveError) throw new Error(effectiveError.message);
    const product = effective as unknown as EffectiveProductData;

    const externalId = listing.external_product_id ?? "";
    if (operation === "listing_publish") {
      result = await adapter.publishProduct!(credentials, product);
    } else if (!externalId) {
      throw new SalesChannelError("This listing has no external product reference");
    } else if (operation === "listing_update") {
      result = await adapter.updateProduct!(credentials, externalId, product);
    } else if (operation === "price_sync") {
      result = await adapter.updatePrice!(credentials, externalId, product);
    } else if (operation === "stock_sync") {
      result = await adapter.updateStock!(credentials, externalId, product);
    } else if (operation === "status_refresh") {
      result = await adapter.refreshProductStatus!(credentials, externalId);
    } else {
      result = await adapter.unpublishProduct!(credentials, externalId);
    }
  } catch (error) {
    result = {
      ok: false,
      message: safeMessage(error),
      failure_class: error instanceof SalesChannelError ? error.failureClass : "unknown",
      ...(error instanceof SalesChannelError && error.retryAfter
        ? { retry_after: error.retryAfter }
        : {}),
    };
  }

  // CONTROLLED FINISH — never leaves the listing stuck in publishing/syncing
  const { data: finished, error: finishError } = await client.rpc("finish_listing_operation", {
    _run_id: runId,
    _listing_id: listingId,
    _operation: operation,
    _ok: result.ok,
    _message: result.message,
    _external_product_id: result.external_product_id ?? null,
    _external_url: result.external_url ?? null,
    _synced_price: result.synced_price ?? null,
    _synced_qty: result.synced_qty ?? null,
    _external_missing: result.external_missing ?? false,
  });
  if (finishError) throw new Error(finishError.message);
  const row = finished as { listing_status: string; external_product_id: string | null };

  // Keep the external mapping authoritative so order import can resolve it.
  if (result.ok && result.external_product_id && operation === "listing_publish") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sp } = await supabaseAdmin
      .from("store_products")
      .select("product_id")
      .eq("id", listing.store_product_id)
      .maybeSingle();
    if (sp?.product_id) {
      await client.rpc("upsert_external_mapping", {
        _account_id: account.id,
        _entity_type: "product",
        _internal_id: sp.product_id,
        _external_id: result.external_product_id,
      });
    }
  }

  return {
    ok: result.ok,
    message: result.message,
    runId,
    listingStatus: row.listing_status,
    externalProductId: row.external_product_id,
    externalMissing: result.external_missing ?? false,
    failureClass: result.ok ? null : (result.failure_class ?? "unknown"),
    retryAfter: result.retry_after ?? null,
  };
}
