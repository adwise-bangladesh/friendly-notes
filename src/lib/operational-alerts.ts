/**
 * Operational incidents — read-only client access to the authoritative
 * `operational_alerts` projection.
 *
 * Detection happens server-side inside the existing ops sweeper; the client
 * only reads the deduplicated incident rows and may acknowledge one when the
 * caller is allowed to manage commerce (enforced in the database).
 */

import { supabase } from "@/integrations/supabase/client";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface OperationalAlert {
  id: string;
  fingerprint: string;
  signal: string;
  category: string;
  severity: AlertSeverity;
  peak_severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: string;
  recommended_action: string;
  entity_type: string | null;
  entity_id: string | null;
  metrics: Record<string, unknown>;
  first_detected_at: string;
  last_detected_at: string;
  detection_count: number;
  acknowledged_at: string | null;
  acknowledged_note: string | null;
}

export interface OperationalHealth {
  generated_at: string;
  summary: {
    critical: number;
    warning: number;
    info: number;
    acknowledged: number;
    resolved_24h: number;
  };
  alerts: OperationalAlert[];
}

export const ALERT_CATEGORY_LABELS: Record<string, string> = {
  workers: "Background workers",
  courier: "Courier operations",
  finance: "COD & settlements",
};

export const SEVERITY_TONE = {
  critical: "danger",
  warning: "warning",
  info: "info",
} as const;

export async function getOperationalHealth(): Promise<OperationalHealth> {
  const { data, error } = await supabase.rpc("operational_health_overview");
  if (error) throw new Error(error.message);
  return data as unknown as OperationalHealth;
}

export async function acknowledgeAlert(alertId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc("acknowledge_operational_alert", {
    _alert_id: alertId,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw new Error(error.message);
}
