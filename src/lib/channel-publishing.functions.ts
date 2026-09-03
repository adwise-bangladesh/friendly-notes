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

async function assertCanManage(client: MinimalClient, userId: string) {
  const { data } = await client.rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to synchronise sales channels");
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
 * Manual runs and background jobs share the very same execution service, so a
 * listing can never be transitioned two different ways. Concurrency is handled
 * in the database: `begin_listing_operation` takes a row lock and refuses to
 * start while the listing is already publishing or syncing.
 */
export const runListingOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => operationInput.parse(input))
  .handler(async ({ data, context }): Promise<ListingOperationResult> => {
    const client = context.supabase as unknown as MinimalClient;
    await assertCanManage(client, context.userId);

    const { executeListingOperation } = await import("./sales-channels/execution.server");
    const result = await executeListingOperation(
      client,
      data.listingId,
      data.operation as ListingOperation,
    );
    return {
      ok: result.ok,
      message: result.message,
      runId: result.runId,
      listingStatus: result.listingStatus,
      externalProductId: result.externalProductId,
      externalMissing: result.externalMissing,
    };
  });
