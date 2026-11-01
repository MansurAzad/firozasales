import { Button } from "@/components/ui/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useLang } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "FE MANAGEMENT — Sign in | FIROZA ENTERPRISE" },
      {
        name: "description",
        content: "Sign in to FIROZA ENTERPRISE's FE MANAGEMENT for stock, SR sales and dealer accounts.",
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
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          toast.error(error.message);
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground">
            FE
          </div>
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
            <div className="mb-4 flex rounded-xl bg-muted p-1">
              <Button
                type="button"
                onClick={() => setMode("signin")}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === "signin"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {t("signIn")}
              </Button>
              <Button
                type="button"
                onClick={() => setMode("signup")}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === "signup"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {t("signUp")}
              </Button>
            </div>

            <form onSubmit={submit}>
              {mode === "signup" ? (
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
              ) : null}
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
              <div className="field">
                <label className="label" htmlFor="auth-pass">
                  {t("password")}
                </label>
                <input
                  id="auth-pass"
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </div>
              <Button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy
                  ? t("loading")
                  : mode === "signin"
                    ? t("signInBtn")
                    : t("signUpBtn")}
              </Button>
            </form>

            {mode === "signup" ? (
              <p className="mt-3 text-xs text-muted-foreground">{t("firstUserNote")}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
