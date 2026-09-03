/**
 * Integration provider registry — client-safe metadata only.
 *
 * This is the single place that answers: what provider is this, what category
 * does it belong to, what can it actually do, and does a server adapter exist?
 * It deliberately contains no credentials, no endpoints and no provider logic;
 * the real work stays in the server adapters (`src/lib/couriers/*.server.ts`).
 *
 * Capabilities mirror the implemented adapter surface exactly. A provider
 * without an adapter still works through the provider-neutral shipment
 * workflow, so it advertises `manual_workflow` instead of API capabilities.
 */

import type { IntegrationCapability, IntegrationProvider } from "@/types/integrations";
import {
  COURIER_CAPABILITY_PROFILES,
  integrationCapabilitiesFor,
} from "./couriers/capabilities";

/**
 * Courier providers are projected from the single capability declaration, so
 * the Integrations Center can never advertise more than the adapters implement.
 */
const COURIER_PROVIDERS: IntegrationProvider[] = Object.values(COURIER_CAPABILITY_PROFILES).map(
  (profile) => ({
    providerKey: profile.providerKey,
    name: profile.name,
    category: "courier",
    capabilities: integrationCapabilitiesFor(profile.providerKey),
    hasAdapter: profile.hasAdapter,
    supportsAccounts: true,
    integrationLevel: profile.integrationLevel,
    accountRequirements: profile.accountRequirements,
    ...(profile.note ? { note: profile.note } : {}),
  }),
);

const PROVIDERS: IntegrationProvider[] = [...COURIER_PROVIDERS];

/** Categories the Integrations Center will host later. Nothing is connectable yet. */
export const PLANNED_PROVIDERS: IntegrationProvider[] = [
  {
    providerKey: "ai_voice",
    name: "AI Voice",
    category: "ai",
    capabilities: [],
    hasAdapter: false,
    supportsAccounts: false,
    integrationLevel: "not_available",
    accountRequirements: [],
    planned: true,
    note: "Planned. Order verification stays the authoritative workflow.",
  },
  {
    providerKey: "sms",
    name: "SMS",
    category: "communication",
    capabilities: [],
    hasAdapter: false,
    supportsAccounts: false,
    integrationLevel: "not_available",
    accountRequirements: [],
    planned: true,
    note: "Planned. No provider configured.",
  },
  {
    providerKey: "whatsapp",
    name: "WhatsApp",
    category: "communication",
    capabilities: [],
    hasAdapter: false,
    supportsAccounts: false,
    integrationLevel: "not_available",
    accountRequirements: [],
    planned: true,
    note: "Planned. No provider configured.",
  },
  {
    providerKey: "facebook",
    name: "Facebook",
    category: "other",
    capabilities: [],
    hasAdapter: false,
    supportsAccounts: false,
    integrationLevel: "not_available",
    accountRequirements: [],
    planned: true,
    note: "Planned. No provider configured.",
  },
];

export function getIntegrationProvider(providerKey: string): IntegrationProvider | null {
  return PROVIDERS.find((p) => p.providerKey === providerKey) ?? null;
}

export function listIntegrationProviders(): IntegrationProvider[] {
  return PROVIDERS;
}

/** Capabilities for a provider key; unknown providers fall back to manual workflow. */
export function capabilitiesFor(providerKey: string): IntegrationCapability[] {
  return getIntegrationProvider(providerKey)?.capabilities ?? ["manual_workflow"];
}

export function hasServerAdapter(providerKey: string): boolean {
  return getIntegrationProvider(providerKey)?.hasAdapter ?? false;
}
