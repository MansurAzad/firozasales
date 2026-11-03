import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WifiOff, RefreshCw, Download, AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import { useLang } from "@/lib/i18n";
import { currentLocalAccount, resolveBlockedProductDelete, syncOffline } from "@/lib/offline";
import { isOffline, type LocalAccount } from "@/lib/offline-store";
import { displayBusinessDate } from "@/lib/business-time";
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function OfflineStatus() {
  const { lang } = useLang(),
    queryClient = useQueryClient();
  const [offline, setOffline] = useState(false),
    [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<LocalAccount>(),
    [install, setInstall] = useState<InstallEvent>();
  const [error, setError] = useState("");
  const [resolving, setResolving] = useState(false);
  const synchronize = useCallback(async () => {
    if (isOffline()) return;
    setBusy(true);
    setError("");
    try {
      await syncOffline();
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      await queryClient.invalidateQueries();
      setAccount(await currentLocalAccount());
      setBusy(false);
    }
  }, [queryClient]);
  useEffect(() => {
    const update = () => {
      setOffline(isOffline());
      void currentLocalAccount().then(setAccount);
    };
    const online = () => {
      update();
      void synchronize();
    };
    const resume = () => {
      if (!isOffline())
        void currentLocalAccount().then((a) => {
          if (a?.entries.length) void synchronize();
        });
    };
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    update();
    void currentLocalAccount().then((a) => {
      if (a?.snapshot && !isOffline()) void synchronize();
    });
    window.addEventListener("online", online);
    window.addEventListener("offline", update);
    window.addEventListener("fe-local-change", update);
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("focus", resume);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", update);
      window.removeEventListener("fe-local-change", update);
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("focus", resume);
    };
  }, [synchronize]);
  const pendingEntries = account?.entries.filter((entry) => !entry.supersededBy) ?? [];
  const retained = (account?.entries.length ?? 0) - pendingEntries.length;
  const blockedEntry = pendingEntries.find(
    (entry) =>
      entry.kind === "catalog" &&
      entry.error?.includes("Stock or history exists; deactivate this product instead"),
  );
  const message = error || pendingEntries.find((entry) => entry.error)?.error;
  return (
    <section
      aria-label={lang === "bn" ? "সংযোগ ও সংরক্ষণ" : "Connection and storage"}
      className="mb-4 border-b border-border pb-3 text-xs text-muted-foreground"
    >
      <div className="flex flex-wrap items-center gap-2">
        {offline && <WifiOff className="h-4 w-4 text-warning-foreground" />}
        <span>
          {offline
            ? lang === "bn"
              ? "অফলাইন · লোকাল হিসাব"
              : "Offline · Local accounts"
            : lang === "bn"
              ? "অনলাইন"
              : "Online"}
        </span>
        {account?.updatedAt && (
          <span>
            {lang === "bn" ? "শেষ সংরক্ষণ" : "Last saved"}:{" "}
            {displayBusinessDate(account.updatedAt, lang === "bn" ? "bn-BD" : "en-GB")}
          </span>
        )}
        {pendingEntries.length > 0 && (
          <strong className="text-warning-foreground">
            {pendingEntries.length}{" "}
            {lang === "bn" ? "এন্ট্রি যাচাই বাকি" : "entries awaiting verification"}
          </strong>
        )}
        {retained > 0 && (
          <span>
            {retained} {lang === "bn" ? "সমাধান করা রেকর্ড সংরক্ষিত" : "resolved records retained"}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={lang === "bn" ? "হিসাব মিলিয়ে নিন" : "Synchronize accounts"}
          title={lang === "bn" ? "হিসাব মিলিয়ে নিন" : "Synchronize accounts"}
          disabled={offline || busy}
          onClick={() => void synchronize()}
        >
          <RefreshCw className={busy ? "animate-spin" : ""} />
        </Button>
        {install && (
          <Button
            variant="outline"
            onClick={async () => {
              await install.prompt();
              await install.userChoice;
              setInstall(undefined);
            }}
          >
            <Download />
            {lang === "bn" ? "ইনস্টল" : "Install"}
          </Button>
        )}
      </div>
      {message && (
        <div
          role="alert"
          className="mt-2 flex flex-col items-start gap-2 break-words text-destructive"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {lang === "bn"
              ? "এন্ট্রি লোকালে আছে; যাচাই সম্পন্ন হয়নি: "
              : "Entries remain saved locally; verification incomplete: "}
            {message}
          </p>
          {blockedEntry && (
            <Button
              variant="outline"
              size="sm"
              disabled={offline || busy || resolving}
              onClick={() => {
                setResolving(true);
                void resolveBlockedProductDelete(blockedEntry.id)
                  .then(synchronize)
                  .catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "Could not resolve entry"),
                  )
                  .finally(async () => {
                    setAccount(await currentLocalAccount());
                    setResolving(false);
                  });
              }}
            >
              {resolving
                ? lang === "bn"
                  ? "পণ্য বন্ধ করা হচ্ছে…"
                  : "Deactivating product…"
                : lang === "bn"
                  ? "মুছবেন না—পণ্যটি বন্ধ করুন"
                  : "Keep product and deactivate instead"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
