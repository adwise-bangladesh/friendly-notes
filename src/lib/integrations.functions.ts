/**
 * Integration operations that must run on the server.
 *
 * Pattern for every sensitive action:
 *   authenticate → re-check role in the database → validate provider/account →
 *   perform the server-only operation → record a safe activity entry.
 *
 * Credentials are only ever touched by the adapter through the service-role
 * client. Nothing returned here contains a token, secret, password or raw
 * provider payload; provider errors are collapsed into safe messages.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CourierError } from "@/types/couriers";

const accountInput = z.object({ accountId: z.string().uuid() });
const stateInput = z.object({
  accountId: z.string().uuid(),
  status: z.enum(["active", "inactive", "disabled"]),
});

export interface IntegrationActionResult {
  ok: boolean;
  message: string;
  testedAt?: string;
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

async function assertCanManage(supabase: unknown, userId: string) {
  const { data } = await (supabase as RpcClient).rpc("can_manage_commerce", { _user_id: userId });
  if (data !== true) throw new Error("You are not permitted to manage integrations");
}

async function assertIsAdmin(supabase: unknown, userId: string) {
  // `is_admin` is not executable by authenticated users by design, so the role
  // is read through the user's own RLS-scoped row instead.
  const client = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string,
        ) => {
          eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown }> };
        };
      };
    };
  };
  const { data } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Only an administrator can change an integration account");
}

/** Collapses any provider failure into an operator-safe sentence. */
function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof CourierError) return error.message;
  if (error instanceof Error && error.message && error.message.length < 200) return error.message;
  return fallback;
}

async function loadAccount(accountId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("courier_accounts")
    .select("id, name, provider_id, environment, status, provider:courier_providers(code, name)")
    .eq("id", accountId)
    .maybeSingle();
  if (!data) throw new Error("Integration account not found");
  const provider = data.provider as { code: string; name: string } | null;
  return { ...data, providerCode: provider?.code ?? "", providerName: provider?.name ?? "" };
}

/**
 * Lightweight, read-only provider call used to prove the account can
 * authenticate. It respects the account environment because the adapter picks
 * the sandbox or production base URL from the account row itself.
 */
export const testIntegrationConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => accountInput.parse(input))
  .handler(async ({ data, context }): Promise<IntegrationActionResult> => {
    await assertCanManage(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);
    const { getCourierAdapter, logCourierCall } = await import("./couriers/registry.server");
    const adapter = getCourierAdapter(account.providerCode);

    if (!adapter?.listCities) {
      return {
        ok: false,
        message: "Connection test unavailable — this provider has no API adapter in this project.",
      };
    }
    if (account.status !== "active") {
      return { ok: false, message: "This account is disabled. Enable it before testing." };
    }

    try {
      const cities = await adapter.listCities(account.id);
      await logCourierCall({
        providerId: account.provider_id,
        accountId: account.id,
        operation: "connection_test",
        succeeded: true,
        safeMessage: `Connection successful (${cities.length} locations reachable)`,
      });
      return {
        ok: true,
        message: `Connection successful in ${account.environment}.`,
        testedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = safeMessage(
        error,
        "The provider rejected the connection. Check the account configuration.",
      );
      await logCourierCall({
        providerId: account.provider_id,
        accountId: account.id,
        operation: "connection_test",
        succeeded: false,
        ...(error instanceof CourierError
          ? {
              statusCode: error.statusCode ?? null,
              errorCategory: error.category,
              retryable: error.retryable,
            }
          : {}),
        safeMessage: message,
      });
      return { ok: false, message, testedAt: new Date().toISOString() };
    }
  });

/** Enable or disable an integration account. Historical records are never removed. */
export const setIntegrationAccountState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => stateInput.parse(input))
  .handler(async ({ data, context }): Promise<IntegrationActionResult> => {
    await assertIsAdmin(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);

    const { error } = await (context.supabase as RpcClient).rpc("set_courier_account_state", {
      _account_id: data.accountId,
      _status: data.status,
    });
    if (error) throw new Error("The integration account could not be updated");

    const { logCourierCall } = await import("./couriers/registry.server");
    await logCourierCall({
      providerId: account.provider_id,
      accountId: account.id,
      operation: "account_state_change",
      succeeded: true,
      safeMessage: `Account set to ${data.status}`,
    });
    return {
      ok: true,
      message:
        data.status === "active"
          ? "Integration account enabled."
          : "Integration account disabled. Automated provider operations are blocked.",
    };
  });

/** Refreshes the cached courier geography for providers that support lookups. */
export const refreshIntegrationLocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => accountInput.parse(input))
  .handler(async ({ data, context }): Promise<IntegrationActionResult> => {
    await assertCanManage(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);
    const { getCourierAdapter, logCourierCall } = await import("./couriers/registry.server");
    const adapter = getCourierAdapter(account.providerCode);
    if (!adapter?.listCities) {
      return { ok: false, message: "This provider does not support location lookup." };
    }
    if (account.status !== "active") {
      return { ok: false, message: "This account is disabled." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      await supabaseAdmin
        .from("courier_locations")
        .delete()
        .eq("provider_id", account.provider_id)
        .eq("kind", "city");
      const cities = await adapter.listCities(account.id);
      await logCourierCall({
        providerId: account.provider_id,
        accountId: account.id,
        operation: "location_refresh",
        succeeded: true,
        safeMessage: `Refreshed ${cities.length} cities`,
      });
      return { ok: true, message: `Refreshed ${cities.length} courier locations.` };
    } catch (error) {
      const message = safeMessage(error, "The provider could not be reached for a location refresh.");
      await logCourierCall({
        providerId: account.provider_id,
        accountId: account.id,
        operation: "location_refresh",
        succeeded: false,
        safeMessage: message,
      });
      return { ok: false, message };
    }
  });
