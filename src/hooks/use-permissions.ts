import { useProfile } from "./use-profile";
import type { AppRole } from "@/types/profile";

export interface CommercePermissions {
  role: AppRole | null;
  isLoading: boolean;
  canRead: boolean;
  canManage: boolean; // create + edit
  canArchive: boolean; // archive + restore
  canDelete: boolean;
}

/**
 * UI-level affordances only. The database (RLS) remains the authority.
 */
export function useCommercePermissions(): CommercePermissions {
  const { data: profile, isLoading } = useProfile();
  const role = profile?.role ?? null;
  const isAdmin = role === "admin" || role === "owner";

  return {
    role,
    isLoading,
    canRead: role !== null,
    canManage: isAdmin || role === "staff",
    canArchive: isAdmin,
    canDelete: isAdmin,
  };
}
