import { Button } from "@/components/ui/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";

import { useLang } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { firstUseMessage, isOffline } from "@/lib/offline-store";
import { localAccess } from "@/lib/offline";
import { CompanyLogo } from "@/components/CompanyLogo";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "FE MANAGEMENT — Sign in | FIROZA ENTERPRISE" },
      {
        name: "description",
        content:
          "Sign in to FIROZA ENTERPRISE's FE MANAGEMENT for stock, SR sales and dealer accounts.",
      },
      { property: "og:title", content: "FE MANAGEMENT — FIROZA ENTERPRISE" },
      {
        property: "og:description",
        content: "Sign in to FIROZA ENTERPRISE's distribution management app.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "recover" | "update-password">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [offline, setOffline] = useState(false);
  const [canOpen, setCanOpen] = useState(false);
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update-password");
    });
    const update = () => {
      setOffline(isOffline());
      void localAccess().then((role) => setCanOpen(!!role));
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isOffline()) {
      toast.error(firstUseMessage);
      return;
    }
    setBusy(true);
    try {
      if (mode === "recover") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success(t("recovery_sent"));
        setMode("signin");
        return;
      }
      if (mode === "update-password") {
        if (password.length < 8 || password !== confirmPassword) {
          toast.error(
            password !== confirmPassword ? t("password_mismatch") : t("recovery_password_hint"),
          );
          return;
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success(t("password_updated_self"));
        navigate({ to: "/dashboard" });
        return;
      }
      if (mode === "signin") {
        const { data: authData, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          toast.error(
            error.code === "invalid_credentials" ? t("invalid_credentials_help") : error.message,
          );
          return;
        }
        const user = authData.user;
        if (!user) throw new Error("Supabase sign-in returned no authenticated user");

        const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] =
          await Promise.all([
            supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle(),
            supabase.from("user_roles").select("role").eq("user_id", user.id),
          ]);
        if (profileError || rolesError) {
          throw new Error((profileError || rolesError)?.message);
        }

        const blockedMessage =
          !profile || !roles?.length
            ? t("account_setup_missing")
            : !profile.is_active
              ? t("account_inactive")
              : null;
        if (blockedMessage) {
          const { error: signOutError } = await supabase.auth.signOut();
          toast.error(
            signOutError ? `${blockedMessage} (${signOutError.message})` : blockedMessage,
          );
          return;
        }
        navigate({ to: "/dashboard" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        if (!data.session) {
          setAwaitingConfirm(true);
          return;
        }
        navigate({ to: "/dashboard" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <CompanyLogo className="mx-auto mb-3 h-24 w-20" />
          <h1 className="text-2xl font-bold text-foreground">{t("appName")}</h1>
          <p className="mt-2 text-sm font-semibold text-primary">{t("companyName")}</p>
        </div>

        {awaitingConfirm ? (
          <div className="card text-center">
            <p className="text-sm text-foreground">{t("checkEmail")}</p>
            <Button
              type="button"
              onClick={() => {
                setAwaitingConfirm(false);
                setMode("signin");
              }}
              className="btn-primary mt-4 w-full"
            >
              {t("signIn")}
            </Button>
          </div>
        ) : (
          <div className="card">
            {offline && (
              <div role="alert" className="mb-4 text-sm text-warning-foreground">
                {canOpen ? "সংরক্ষিত হিসাব প্রস্তুত / Saved accounts ready" : firstUseMessage}
                {canOpen && (
                  <Button className="mt-3 w-full" onClick={() => navigate({ to: "/dashboard" })}>
                    সংরক্ষিত হিসাব খুলুন / Open saved accounts
                  </Button>
                )}
              </div>
            )}
            <div className="mb-4 flex rounded-xl bg-muted p-1">
              <Button
                variant="ghost"
                type="button"
                disabled={mode === "recover" || mode === "update-password"}
                onClick={() => setMode("signin")}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === "signin" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {t("signIn")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={mode === "recover" || mode === "update-password"}
                onClick={() => setMode("signup")}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === "signup" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {t("signUp")}
              </Button>
            </div>

            <form onSubmit={submit}>
              {mode === "signup" && (
                <div className="field">
                  <label className="label" htmlFor="auth-name">
                    {t("fullName")}
                  </label>
                  <input
                    id="auth-name"
                    className="input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
              )}
              {mode !== "update-password" && (
                <div className="field">
                  <label className="label" htmlFor="auth-email">
                    {t("email")}
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
              )}
              {mode !== "recover" && (
                <div className="field">
                  <label className="label" htmlFor="auth-pass">
                    {mode === "update-password" ? t("new_password") : t("password")}
                  </label>
                  <input
                    id="auth-pass"
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={mode === "update-password" ? 8 : 6}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  />
                </div>
              )}
              {mode === "update-password" && (
                <div className="field">
                  <label className="label" htmlFor="auth-pass-confirm">
                    {t("confirm_password")}
                  </label>
                  <input
                    id="auth-pass-confirm"
                    type="password"
                    className="input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
              )}
              <Button type="submit" className="btn-primary w-full" disabled={busy || offline}>
                {busy
                  ? t("loading")
                  : mode === "signin"
                    ? t("signInBtn")
                    : mode === "signup"
                      ? t("signUpBtn")
                      : mode === "recover"
                        ? t("send_recovery")
                        : t("update_password")}
              </Button>
            </form>

            {mode === "signin" && (
              <Button
                type="button"
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => setMode("recover")}
              >
                {t("forgot_password")}
              </Button>
            )}
            {(mode === "recover" || mode === "update-password") && (
              <Button
                type="button"
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => setMode("signin")}
              >
                {t("cancel")}
              </Button>
            )}
            {mode === "signup" ? (
              <p className="mt-3 text-xs text-muted-foreground">{t("firstUserNote")}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
