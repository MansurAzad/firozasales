import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { localAccess, saveRole } from './offline';
import { isOffline } from './offline-store';

export interface MyRole {
  userId: string;
  isAdmin: boolean;
  fullName: string;
  isActive: boolean;
}

export function useMyRole() {
  return useQuery<MyRole | null>({
    queryKey: ["my-role"],
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async () => {
      if (isOffline()) return localAccess();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const [{ data: isAdmin, error: roleError }, { data: profile, error: profileError }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }),
        supabase
          .from("profiles")
          .select("id, full_name, is_active")
          .eq("id", user.id)
          .maybeSingle(),
      ]);
      if (roleError || profileError) throw new Error((roleError || profileError)?.message);
      const role = {
        userId: user.id,
        isAdmin: isAdmin === true,
        fullName: profile?.full_name ?? "",
        isActive: profile?.is_active ?? false,
      };
      await saveRole(role);
      return role;
    },
  });
}

/** Admin-only page guard inside the component (RLS still protects data). */
export function useAdminGate() {
  const role = useMyRole();
  return { loading: role.isLoading, isAdmin: role.data?.isAdmin === true };
}
