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
const scopeInput = z.object({
  accountId: z.string().uuid(),
  storeId: z.string().uuid().nullable(),
  isDefault: z.boolean(),
});
// A blank field means "leave unchanged" — secrets are never echoed back, so the
// UI cannot pre-fill them and must not clear them by omission.
const credentialsInput = z.object({
  accountId: z.string().uuid(),
  clientId: z.string().trim().max(200).optional(),
  username: z.string().trim().max(200).optional(),
  clientSecret: z.string().max(2000).optional(),
  password: z.string().max(2000).optional(),
  webhookSecret: z.string().max(2000).optional(),
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
  // `is_admin` is intentionally not executable by authenticated users, so the
  // role is read through the caller's own RLS-scoped user_roles rows.
  const client = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => PromiseLike<{ data: { role: string }[] | null }>;
      };
    };
  };
  const { data } = await client.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role);
  if (!roles.includes("admin") && !roles.includes("owner")) {
    throw new Error("Only an administrator can change an integration account");
  }
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
      // Clear the cached city list first so the adapter is forced to make a
      // real authenticated call to the provider instead of serving the cache.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("courier_locations")
        .delete()
        .eq("provider_id", account.provider_id)
        .eq("kind", "city");
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

/**
 * Scope an account to one store, or leave it organization-wide (`storeId: null`).
 * The database enforces "one active default per provider per scope"; a clash is
 * reported as a readable sentence rather than a constraint error.
 */
export const setIntegrationAccountScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => scopeInput.parse(input))
  .handler(async ({ data, context }): Promise<IntegrationActionResult> => {
    await assertIsAdmin(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);

    const { error } = await (context.supabase as RpcClient).rpc("set_courier_account_scope", {
      _account_id: data.accountId,
      _store_id: data.storeId,
      _is_default: data.isDefault,
    });
    if (error) {
      throw new Error(
        safeMessage(error, "The integration account scope could not be updated"),
      );
    }

    const { logCourierCall } = await import("./couriers/registry.server");
    await logCourierCall({
      providerId: account.provider_id,
      accountId: account.id,
      operation: "account_state_change",
      succeeded: true,
      safeMessage: data.storeId
        ? `Scoped to a single store${data.isDefault ? " as default" : ""}`
        : `Organization-wide${data.isDefault ? " default" : ""}`,
    });
    return { ok: true, message: "Integration account scope updated." };
  });

/**
 * Writes credentials into the encrypted vault through the service-role-only
 * function. Nothing secret is returned; the response only says what is now
 * configured. Blank fields are left untouched.
 */
export const saveIntegrationCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => credentialsInput.parse(input))
  .handler(async ({ data, context }): Promise<IntegrationActionResult> => {
    await assertIsAdmin(context.supabase, context.userId);
    const account = await loadAccount(data.accountId);

    const { setCourierCredentials } = await import("./couriers/credentials.server");
    try {
      await setCourierCredentials(data.accountId, {
        clientId: data.clientId ?? null,
        username: data.username ?? null,
        clientSecret: data.clientSecret ?? null,
        password: data.password ?? null,
        webhookSecret: data.webhookSecret ?? null,
      });
    } catch (error) {
      throw new Error(safeMessage(error, "The credentials could not be saved"));
    }

    const { logCourierCall } = await import("./couriers/registry.server");
    await logCourierCall({
      providerId: account.provider_id,
      accountId: account.id,
      operation: "account_state_change",
      succeeded: true,
      safeMessage: "Credentials updated",
    });
    return {
      ok: true,
      message: "Credentials stored securely. Existing cached tokens were cleared.",
    };
  });
