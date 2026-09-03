/**
 * Channel publishing & synchronisation — server operations.
 *
 * Shape of every operation:
 *   permission → backend readiness → controlled BEGIN (locks the listing and
 *   opens a sync run) → provider call with server-only credentials →
 *   controlled FINISH (state transition, external reference, append-only
 *   event, sync run closed).
 *
 * Nothing here writes a listing, mapping or sync run row directly, no
 * credential or provider body ever leaves the server, and inventory is never
 * mutated — outbound sync is representation only.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SalesChannelError } from "./sales-channels/adapter";
import type { EffectiveProductData, PublishResult } from "./sales-channels/adapter";
import { OPERATION_CAPABILITY } from "./sales-channels/capabilities";
import type { ListingOperation } from "./sales-channels/capabilities";

const OPERATIONS = [
  "listing_publish",
  "listing_update",
  "price_sync",
  "stock_sync",
  "status_refresh",
  "unpublish",
] as const;

const operationInput = z.object({
  listingId: z.string().uuid(),
  operation: z.enum(OPERATIONS),
});

export interface ListingReadiness {
  listing_id: string;
  ready: boolean;
  blocking: string[];
  warnings: string[];
  provider: string;
  listing_status: string;
  effective_title: string | null;
  effective_sku: string | null;
  effective_price: number | null;
  available_qty: number;
  external_product_id: string | null;
}

export interface ListingOperationResult {
  ok: boolean;
  message: string;
  runId: string | null;
  listingStatus: string | null;
  externalProductId: string | null;
  externalMissing: boolean;
}

type MinimalClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function safeMessage(error: unknown): string {
  if (error instanceof SalesChannelError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 300);
  return "The operation failed";
}

async function assertCanManage(client: MinimalClient, userId: string) {
  const { data } = await client.rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to synchronise sales channels");
}

async function loadListingContext(listingId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("sales_channel_product_listings")
    .select("id, store_product_id, sales_channel_account_id, external_product_id, listing_status")
    .eq("id", listingId)
    .maybeSingle();
  if (!data) throw new Error("Listing not found");
  const { data: account } = await supabaseAdmin
    .from("sales_channel_accounts")
    .select("id, provider, status, store_id")
    .eq("id", data.sales_channel_account_id)
    .maybeSingle();
  if (!account) throw new Error("Sales channel not found");
  return { listing: data, account };
}

/** Backend-authoritative readiness. The UI only renders the result. */
export const checkListingReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ listingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ListingReadiness> => {
    const client = context.supabase as unknown as MinimalClient;
    const { data: result, error } = await client.rpc("record_listing_readiness_check", {
      _listing_id: data.listingId,
    });
    if (error) throw new Error(error.message);
    return result as unknown as ListingReadiness;
  });

/**
 * One entry point for publish / update / price / stock / status / unpublish.
 * Concurrency is handled in the database: `begin_listing_operation` takes a row
 * lock and refuses to start while the listing is already publishing or syncing,
 * so a double click or two users cannot produce two external products.
 */
export const runListingOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => operationInput.parse(input))
  .handler(async ({ data, context }): Promise<ListingOperationResult> => {
    const client = context.supabase as unknown as MinimalClient;
    await assertCanManage(client, context.userId);

    const operation = data.operation as ListingOperation;
    const { listing, account } = await loadListingContext(data.listingId);

    const { getSalesChannelAdapter, loadCredentials } = await import(
      "./sales-channels/registry.server"
    );
    const adapter = getSalesChannelAdapter(account.provider);
    if (!adapter || !adapter.capabilities.includes(OPERATION_CAPABILITY[operation])) {
      return {
        ok: false,
        message: "This sales channel does not support that operation",
        runId: null,
        listingStatus: listing.listing_status,
        externalProductId: listing.external_product_id,
        externalMissing: false,
      };
    }

    // Readiness gates the operations that push our data outward.
    if (operation === "listing_publish" || operation === "listing_update") {
      const { data: readiness, error: readinessError } = await client.rpc(
        "channel_listing_readiness",
        { _listing_id: data.listingId },
      );
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
        };
      }
    }

    // CONTROLLED BEGIN — row lock + state transition + sync run
    const { data: begun, error: beginError } = await client.rpc("begin_listing_operation", {
      _listing_id: data.listingId,
      _operation: operation,
    });
    if (beginError) throw new Error(beginError.message);
    const runId = (begun as { run_id: string }).run_id;

    let result: PublishResult;
    try {
      const credentials = await loadCredentials(account.id);
      if (!credentials) throw new SalesChannelError("No credentials are configured for this connection");

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
      result = { ok: false, message: safeMessage(error) };
    }

    // CONTROLLED FINISH — never leaves the listing stuck in publishing/syncing
    const { data: finished, error: finishError } = await client.rpc("finish_listing_operation", {
      _run_id: runId,
      _listing_id: data.listingId,
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
      await client.rpc("upsert_external_mapping", {
        _account_id: account.id,
        _entity_type: "product",
        _internal_id: (
          await (async () => {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: sp } = await supabaseAdmin
              .from("store_products")
              .select("product_id")
              .eq("id", listing.store_product_id)
              .maybeSingle();
            return sp;
          })()
        )?.product_id,
        _external_id: result.external_product_id,
      });
    }

    return {
      ok: result.ok,
      message: result.message,
      runId,
      listingStatus: row.listing_status,
      externalProductId: row.external_product_id,
      externalMissing: result.external_missing ?? false,
    };
  });
