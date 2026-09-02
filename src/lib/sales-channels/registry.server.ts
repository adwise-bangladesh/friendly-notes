/**
 * Server-only sales channel registry.
 *
 * Maps a provider code to the adapter that can actually talk to it, and loads
 * credentials with the service-role client. The credentials object never
 * leaves this module boundary — callers pass it straight into an adapter.
 */

import type { SalesChannelAdapter, SalesChannelCredentials } from "./adapter";
import { wooCommerceAdapter } from "./woocommerce.server";

const ADAPTERS: Record<string, SalesChannelAdapter> = {
  woocommerce: wooCommerceAdapter,
};

export function getSalesChannelAdapter(provider: string): SalesChannelAdapter | null {
  return ADAPTERS[provider] ?? null;
}

export async function loadCredentials(accountId: string): Promise<SalesChannelCredentials | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("sales_channel_credentials")
    .select("site_url, consumer_key, consumer_secret, api_version")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!data || !data.consumer_key || !data.consumer_secret) return null;
  return {
    site_url: data.site_url,
    consumer_key: data.consumer_key,
    consumer_secret: data.consumer_secret,
    api_version: data.api_version ?? "wc/v3",
  };
}
