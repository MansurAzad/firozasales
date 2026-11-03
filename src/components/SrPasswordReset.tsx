import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { onlineRequired } from "@/lib/offline-store";
import { resetSalesmanPassword } from "@/lib/admin.functions";

export function SrPasswordReset({
  userId,
  name,
  email,
}: {
  userId: string;
  name: string;
  email: string;
}) {
  const { t } = useLang();
  const reset = useServerFn(resetSalesmanPassword);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function close() {
    setOpen(false);
    setPassword("");
    setConfirm("");
    setError("");
  }
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        title={t("reset_password")}
        aria-label={`${t("reset_password")} · ${email}`}
        onClick={() => setOpen(true)}
      >
        <KeyRound />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (busy) return;
          if (value) setOpen(true);
          else close();
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto">
          <DialogTitle>{t("reset_password")}</DialogTitle>
          <DialogDescription className="break-all">
            {name} · {email}
          </DialogDescription>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (password !== confirm) {
                setError(t("password_mismatch"));
                return;
              }
              setBusy(true);
              setError("");
              try {
                onlineRequired();
                const result = await reset({ data: { userId, password } });
                if (!result.ok) {
                  setError(t("password_reset_failed"));
                  return;
                }
                toast.success(t("password_updated"));
                close();
              } catch {
                setError(t("password_reset_failed"));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field">
              <label className="label" htmlFor={`new-${userId}`}>
                {t("new_password")}
              </label>
              <input
                id={`new-${userId}`}
                type="password"
                autoComplete="new-password"
                className="input"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor={`confirm-${userId}`}>
                {t("confirm_password")}
              </label>
              <input
                id={`confirm-${userId}`}
                type="password"
                autoComplete="new-password"
                className="input"
                minLength={8}
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                disabled={busy}
              />
            </div>
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? t("loading") : t("save")}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
