import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LogOut,
  Languages,
  House,
  Package,
  PackagePlus,
  ShoppingCart,
  Store,
  Wallet,
  Users,
  FileChartColumn,
  Menu,
  Settings,
  ShieldCheck,
  Undo2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { useLang } from "@/lib/i18n";
import { useMyRole } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CompanyLogo } from "@/components/CompanyLogo";
import { OfflineStatus } from "./OfflineStatus";
import { currentLocalAccount, forgetLocalIdentity } from "@/lib/offline";
import { clearAccount } from "@/lib/offline-store";

interface AppShellProps {
  title: string;
  children: ReactNode;
}

const ADMIN_NAV = [
  { to: "/dashboard", label: "nav_dashboard", icon: House },
  { to: "/products", label: "nav_products", icon: Package },
  { to: "/stock-issue", label: "nav_stock_issue", icon: PackagePlus },
  { to: "/stock-receipt", label: "nav_stock_receipt", icon: PackagePlus },
  { to: "/sales", label: "nav_new_sale", icon: ShoppingCart },
  { to: "/retailers", label: "nav_retailers", icon: Store },
  { to: "/settlement", label: "nav_settlement", icon: Wallet },
  { to: "/salesmen", label: "nav_salesmen", icon: Users },
  { to: "/reports", label: "nav_reports", icon: FileChartColumn },
  { to: "/settings", label: "nav_settings", icon: Settings },
  { to: "/access-control", label: "nav_access", icon: ShieldCheck },
  { to: "/transaction-reversals", label: "nav_reversals", icon: Undo2 },
] as const;

const SALESMAN_NAV = [
  { to: "/dashboard", label: "nav_home", icon: House },
  { to: "/sales", label: "nav_new_sale", icon: ShoppingCart },
  { to: "/retailers", label: "nav_retailers", icon: Store },
  { to: "/settlement", label: "nav_settlement", icon: Wallet },
  { to: "/reports", label: "nav_reports", icon: FileChartColumn },
] as const;

export function AppShell({ title, children }: AppShellProps) {
  const { t, lang, setLang } = useLang();
  const role = useMyRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);

  useEffect(() => {
    setSidebarPinned(window.localStorage.getItem("fe-sidebar-pinned") === "true");
  }, []);

  const items = role.data?.isAdmin ? ADMIN_NAV : SALESMAN_NAV;
  const mobileItems = role.data?.isAdmin
    ? ADMIN_NAV.filter((item) => ["/dashboard", "/stock-receipt", "/stock-issue"].includes(item.to))
    : SALESMAN_NAV.filter((item) => ["/dashboard", "/sales", "/settlement"].includes(item.to));
  async function handleSignOut() {
    const local = await currentLocalAccount();
    if (
      local?.entries.length &&
      !window.confirm(
        "লোকাল এন্ট্রি সাইন আউটের পরও এই ডিভাইসে থাকবে; একই অ্যাকাউন্টে ফিরে মিলিয়ে নিন। / Pending entries will remain on this device. Sign back into the same account to sync.",
      )
    )
      return;
    if (local && !local.entries.length) await clearAccount(local.role.userId);
    await queryClient.cancelQueries();
    queryClient.clear();
    forgetLocalIdentity();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="app-shell min-h-dvh bg-background">
      <aside
        className="desktop-sidebar group/sidebar hidden border-r border-border bg-card/95 backdrop-blur md:flex"
        data-pinned={sidebarPinned}
      >
        <div className="sidebar-brand flex min-h-16 items-center gap-3 border-b border-border px-3">
          <CompanyLogo className="h-10 w-8 shrink-0" />
          <div className="sidebar-label min-w-0">
            <div className="truncate text-sm font-bold text-primary">{t("appName")}</div>
            <div className="truncate text-[10px] text-muted-foreground">{t("companyName")}</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="sidebar-toggle ml-auto h-10 w-10 shrink-0"
            aria-label={t(sidebarPinned ? "sidebar_autohide" : "sidebar_pin")}
            aria-pressed={sidebarPinned}
            title={t(sidebarPinned ? "sidebar_autohide" : "sidebar_pin")}
            onClick={() => {
              const nextPinned = !sidebarPinned;
              window.localStorage.setItem("fe-sidebar-pinned", String(nextPinned));
              setSidebarPinned(nextPinned);
            }}
          >
            {sidebarPinned ? (
              <PanelLeftClose className="h-5 w-5" />
            ) : (
              <PanelLeftOpen className="h-5 w-5" />
            )}
          </Button>
        </div>
        <nav aria-label={t("main_navigation")} className="sidebar-navigation flex-1 space-y-1 p-2">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-label={t(item.label)}
              title={t(item.label)}
              className="sidebar-destination"
              activeOptions={{ exact: item.to !== "/retailers" }}
              activeProps={{ "aria-current": "page" }}
            >
              <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="sidebar-label">{t(item.label)}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="app-main min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
          <div className="app-header-inner mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <CompanyLogo className="h-12 w-10 md:hidden" />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-primary md:hidden">
                  {t("appName")}
                </div>
                <div className="truncate text-xs text-muted-foreground md:hidden">{title}</div>
                <div className="text-[10px] font-medium text-muted-foreground md:hidden">
                  {t("companyName")}
                </div>
                <h1 className="hidden truncate text-lg font-semibold md:block">{title}</h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild variant="ghost" size="icon" className="h-11 w-11">
                <Link to="/settings" aria-label={t("nav_settings")} title={t("nav_settings")}>
                  <Settings className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => setLang(lang === "bn" ? "en" : "bn")}
                className="min-h-11 gap-1 px-2"
                aria-label={t("other_lang")}
                title={t("other_lang")}
              >
                <Languages className="h-4 w-4" />
                {t("other_lang")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={handleSignOut}
                className="h-11 w-11"
                aria-label={t("signOut")}
                title={t("signOut")}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="page">
          <OfflineStatus />
          {role.data && !role.data.isActive ? (
            <p className="text-destructive">{t("account_inactive")}</p>
          ) : (
            children
          )}
        </main>

        <nav
          aria-label={t("main_navigation")}
          className="bottom-navigation fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur md:hidden"
        >
          <div className="mx-auto grid max-w-3xl grid-cols-4">
            {mobileItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="nav-destination"
                activeOptions={{ exact: item.to !== "/retailers" }}
                activeProps={{ "aria-current": "page" }}
              >
                <item.icon aria-hidden="true" className="h-5 w-5" />
                <span>{t(item.label === "nav_dashboard" ? "nav_home" : item.label)}</span>
              </Link>
            ))}
            <Button
              variant="ghost"
              className="nav-destination h-auto rounded-none"
              aria-label={t("more_menu")}
              onClick={() => setMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
              <span>{t("more_menu")}</span>
            </Button>
          </div>
        </nav>
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent
            side="bottom"
            className="mobile-menu max-h-[85dvh] overflow-y-auto rounded-t-lg"
          >
            <SheetTitle>{t("all_menu")}</SheetTitle>
            <SheetDescription>{t("companyName")}</SheetDescription>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {items.map((item) => (
                <Button
                  key={item.to}
                  asChild
                  variant="ghost"
                  className="h-auto min-h-14 justify-start whitespace-normal py-3"
                >
                  <Link
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    activeOptions={{ exact: item.to !== "/retailers" }}
                    activeProps={{ className: "bg-primary/10 text-primary" }}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{t(item.label)}</span>
                  </Link>
                </Button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
