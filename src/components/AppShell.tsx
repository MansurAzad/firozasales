import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Languages } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";

interface AppShellProps {
  title: string;
  children: ReactNode;
}

const ADMIN_NAV = [
  { to: "/dashboard", label: "nav_dashboard" },
  { to: "/products", label: "nav_products" },
  { to: "/stock-issue", label: "nav_stock_issue" },
  { to: "/sales", label: "nav_new_sale" },
  { to: "/retailers", label: "nav_retailers" },
  { to: "/settlement", label: "nav_settlement" },
  { to: "/salesmen", label: "nav_salesmen" },
  { to: "/reports", label: "nav_reports" },
] as const;

const SALESMAN_NAV = [
  { to: "/dashboard", label: "nav_home" },
  { to: "/sales", label: "nav_new_sale" },
  { to: "/retailers", label: "nav_retailers" },
  { to: "/settlement", label: "nav_settlement" },
  { to: "/reports", label: "nav_reports" },
] as const;

export function AppShell({ title, children }: AppShellProps) {
  const { t, lang, setLang } = useLang();
  const role = useMyRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const items = role.data?.isAdmin ? ADMIN_NAV : SALESMAN_NAV;

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-primary">
              {t("appName")}
            </div>
            <div className="truncate text-xs text-muted-foreground">{title}</div>
            <div className="text-[10px] font-medium text-muted-foreground">{t("companyName")}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLang(lang === "bn" ? "en" : "bn")}
              className="btn-ghost btn-sm gap-1"
              aria-label="Language"
            >
              <Languages className="h-4 w-4" />
              {t("other_lang")}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="btn-ghost btn-sm"
              aria-label={t("signOut")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="page">{role.data && !role.data.isActive ? <p className="text-destructive">{t("account_inactive")}</p> : children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div
          className="mx-auto grid max-w-3xl"
          style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:text-primary"
              activeProps={{ className: "text-primary" }}
            >
              {t(item.label)}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
