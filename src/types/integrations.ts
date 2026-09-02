/**
 * Integrations Center types.
 *
 * The Integrations Center is a MANAGEMENT layer. It describes providers,
 * accounts, capabilities, connection state, health and activity. It never
 * owns order, shipment, verification or automation state — those modules stay
 * authoritative. Courier data is read from the existing courier tables; no
 * parallel provider/account tables exist.
 *
 * This module is client-safe: it contains no credentials and no network code.
 */

import type { CourierEnvironment, CourierProviderStatus } from "./shipping";
import type { CourierIntegrationLevel } from "./couriers";

export type IntegrationCategory = "courier" | "communication" | "ai" | "webhook" | "other";

export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  courier: "Courier & Delivery",
  communication: "Communication",
  ai: "AI",
  webhook: "Webhooks",
  other: "Other",
};

/** How the account currently stands with the provider. Never mixed with environment. */
export type IntegrationConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "disabled"
  | "unknown";

export const INTEGRATION_CONNECTION_LABELS: Record<IntegrationConnectionStatus, string> = {
  connected: "Connected",
  disconnected: "Not connected",
  error: "Error",
  disabled: "Disabled",
  unknown: "Unknown",
};

export const INTEGRATION_CONNECTION_TONE: Record<
  IntegrationConnectionStatus,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  connected: "success",
  disconnected: "neutral",
  error: "danger",
  disabled: "warning",
  unknown: "neutral",
};

/** Capabilities are derived from real adapters only — never advertised blindly. */
export type IntegrationCapability =
  | "create_shipment"
  | "refresh_tracking"
  | "delivery_quote"
  | "location_lookup"
  | "cancel_shipment"
  | "webhook_processing"
  | "manual_workflow";

export const INTEGRATION_CAPABILITY_LABELS: Record<IntegrationCapability, string> = {
  create_shipment: "Create shipment",
  refresh_tracking: "Refresh tracking status",
  delivery_quote: "Delivery quote",
  location_lookup: "Location lookup",
  cancel_shipment: "Cancel shipment",
  webhook_processing: "Webhook processing",
  manual_workflow: "Manual workflow available",
};

export type IntegrationActivityType =
  | "connection_test"
  | "token_refresh"
  | "shipment_booking"
  | "status_refresh"
  | "quote_request"
  | "location_refresh"
  | "webhook_applied"
  | "webhook_ignored"
  | "webhook_failed"
  | "account_state_change";

export const INTEGRATION_ACTIVITY_LABELS: Record<string, string> = {
  connection_test: "Connection test",
  token_refresh: "Token refresh",
  shipment_booking: "Shipment booking",
  status_refresh: "Status refresh",
  quote_request: "Quote request",
  location_refresh: "Location refresh",
  webhook_applied: "Webhook applied",
  webhook_ignored: "Webhook ignored",
  webhook_failed: "Webhook failed",
  account_state_change: "Account state change",
};

export type IntegrationActivityStatus = "success" | "failed" | "ignored";

export const INTEGRATION_ACTIVITY_TONE: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  success: "success",
  failed: "danger",
  ignored: "neutral",
};

/**
 * A provider definition. Purely descriptive metadata — the registry never
 * holds credentials and never performs provider work.
 */
export interface IntegrationProvider {
  providerKey: string;
  name: string;
  category: IntegrationCategory;
  /** Real capabilities only. Providers without an adapter list manual_workflow. */
  capabilities: IntegrationCapability[];
  /** True when a server adapter exists in this project. */
  hasAdapter: boolean;
  /** True when accounts can be connected today. */
  supportsAccounts: boolean;
  integrationLevel: CourierIntegrationLevel | "not_available";
  /** Configuration the account needs before automated operations can run. */
  accountRequirements: string[];
  /** Set for planned categories so the UI can be honest about them. */
  planned?: boolean;
  note?: string;
}

/** A connected account, projected from the existing courier tables. */
export interface IntegrationAccount {
  id: string;
  providerId: string;
  providerKey: string;
  providerName: string;
  providerStatus: CourierProviderStatus;
  category: IntegrationCategory;
  name: string;
  code: string;
  environment: CourierEnvironment;
  externalStoreId: string | null;
  accountStatus: CourierProviderStatus;
  isDefault: boolean;
  capabilities: IntegrationCapability[];
  hasAdapter: boolean;
  connection: IntegrationConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationAccountHealth {
  account_id: string;
  has_credentials: boolean;
  has_webhook_secret: boolean;
  last_token_refresh_at: string | null;
  token_expires_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_message: string | null;
  failure_count_24h: number;
  last_webhook_at: string | null;
  last_activity_at: string | null;
}

export interface IntegrationActivityEntry {
  id: string;
  created_at: string;
  provider_id: string | null;
  provider_name: string | null;
  account_id: string | null;
  account_name: string | null;
  environment: string | null;
  activity_type: string;
  status: string;
  message: string | null;
  shipment_id: string | null;
  total_count: number;
}

export interface IntegrationWebhookOverviewRow {
  provider_id: string;
  provider_code: string;
  provider_name: string;
  account_id: string;
  account_name: string;
  environment: string;
  webhook_configured: boolean;
  last_received_at: string | null;
  applied_count: number;
  duplicate_count: number;
  ignored_count: number;
  rejected_count: number;
}
