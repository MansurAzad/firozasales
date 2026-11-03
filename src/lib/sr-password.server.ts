import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const srPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8).max(128),
});

export async function authorizeSrPasswordReset(
  client: SupabaseClient<Database>,
  actorId: string,
  targetId: string,
) {
  const { data: admin, error } = await client.rpc("has_role", {
    _user_id: actorId,
    _role: "admin",
  });
  if (error || admin !== true) throw new Error("Forbidden");
  const { error: inactive } = await client.rpc("require_active_account");
  if (inactive) throw new Error("Forbidden");
  const { data: roles, error: targetError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", targetId);
  if (
    targetError ||
    !roles?.some((r) => r.role === "salesman") ||
    roles.some((r) => r.role === "admin")
  ) {
    throw new Error("Only SR accounts can be reset");
  }
}
