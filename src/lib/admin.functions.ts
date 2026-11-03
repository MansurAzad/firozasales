import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
});

/**
 * Admin creates a salesman account. Verified by role check first; the
 * service-role client is loaded inside the handler only, after authorization.
 */
export const createSalesmanAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin" as never,
    });
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Forbidden");
    const { error: activeError } = await context.supabase.rpc("require_active_account");
    if (activeError) throw new Error(activeError.message);

    const { requireSupabaseAdminClient } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = requireSupabaseAdminClient();
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
      app_metadata: { fe_account_provisioning: "admin" },
    });
    if (error) throw new Error(error.message);
    return { id: created.user?.id ?? null };
  });

export const resetSalesmanPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    // Fixed messages prevent validation errors from echoing password input.
    const parsed = z
      .object({ userId: z.string().uuid(), password: z.string().min(8).max(128) })
      .safeParse(input);
    if (!parsed.success) throw new Error("Invalid password reset request");
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    const { authorizeSrPasswordReset } = await import("@/lib/sr-password.server");
    await authorizeSrPasswordReset(context.supabase, context.userId, data.userId);
    const { requireSupabaseAdminClient } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = requireSupabaseAdminClient();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) return { ok: false as const };
    return { ok: true as const };
  });

export const listSalesmanAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: admin, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error || admin !== true) throw new Error("Forbidden");
    const { error: inactive } = await context.supabase.rpc("require_active_account");
    if (inactive) throw new Error("Forbidden");
    const { data: roles, error: rolesError } = await context.supabase
      .from("user_roles")
      .select("user_id, role");
    if (rolesError) throw new Error("Could not read SR accounts");
    const srIds = new Set(
      (roles ?? [])
        .filter(
          (r) =>
            r.role === "salesman" &&
            !roles?.some((a) => a.user_id === r.user_id && a.role === "admin"),
        )
        .map((r) => r.user_id),
    );
    if (!srIds.size) return { accounts: [], authManagementAvailable: true };
    const { data: profiles, error: profileError } = await context.supabase
      .from("profiles")
      .select("id, full_name, is_active, created_at")
      .in("id", [...srIds]);
    if (profileError) throw new Error("Could not read SR accounts");
    const emails = new Map<string, string>();
    const { getSupabaseAdminClient } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = getSupabaseAdminClient();
    if (!supabaseAdmin) {
      return {
        accounts: (profiles ?? []).map((p) => ({ ...p, email: "" })),
        authManagementAvailable: false,
      };
    }
    for (let page = 1; ; page++) {
      const { data, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listError) {
        return {
          accounts: (profiles ?? []).map((p) => ({ ...p, email: "" })),
          authManagementAvailable: false,
        };
      }
      for (const user of data.users) if (srIds.has(user.id)) emails.set(user.id, user.email ?? "");
      if (data.users.length < 1000) break;
    }
    return {
      accounts: (profiles ?? []).map((p) => ({ ...p, email: emails.get(p.id) ?? "" })),
      authManagementAvailable: true,
    };
  });
