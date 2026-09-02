import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Profile } from "@/types/profile";

export function useProfile() {
  return useQuery<Profile | null>({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, role, created_at, updated_at")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        ...data,
        role: data.role as AppRole,
        full_name: data.full_name ?? userData.user.email ?? null,
      } as Profile;
    },
    staleTime: 60_000,
  });
}
