import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { localAccess } from "@/lib/offline";
import { isOffline } from "@/lib/offline-store";

// Integration-managed-style gate for the whole app: client-only session check.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    if (isOffline()) {
      if (await localAccess()) return;
      throw redirect({ to: "/auth" });
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
