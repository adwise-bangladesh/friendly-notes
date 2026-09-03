/**
 * Team role administration — browser data access.
 *
 * Roles are never written directly from the client: `user_roles` is protected
 * and every change goes through a controlled database function that enforces
 * the boundaries (no self-escalation, only an owner can grant or change owner,
 * the last owner cannot be removed) and records an entry in the role history.
 */

import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/types/profile";

export interface WorkspaceUser {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: AppRole | null;
  joined_at: string;
}

export interface RoleChangeEvent {
  id: string;
  target_user_id: string;
  action: string;
  role_from: AppRole | null;
  role_to: AppRole | null;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
}

export async function fetchWorkspaceUsers(): Promise<WorkspaceUser[]> {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) throw error;
  return (data ?? []) as unknown as WorkspaceUser[];
}

export async function fetchRoleHistory(limit = 20): Promise<RoleChangeEvent[]> {
  const { data, error } = await supabase
    .from("role_change_events")
    .select("id, target_user_id, action, role_from, role_to, reason, actor_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as RoleChangeEvent[];
}

export async function assignUserRole(userId: string, role: AppRole, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("admin_set_user_role", {
    _user_id: userId,
    _role: role,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
}

export async function revokeUserRole(userId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("admin_revoke_user_role", {
    _user_id: userId,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
}
