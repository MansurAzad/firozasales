import { Camera, Keyboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLang } from "@/lib/i18n";
import { isPlausibleImei, normalizeImei } from "@/lib/imei";

export interface ImeiCheckResult {
  ok: boolean;
  message: string;
}

interface ImeiScannerProps {
  /** Validate a code; red signal + vibration when not ok, green when ok. */
  check: (code: string) => ImeiCheckResult | Promise<ImeiCheckResult>;
  /** Called for every code that passed validation. */
  onAccepted?: (code: string) => void;
  hint?: string;
}

/**
 * Barcode scanner using html5-qrcode. The camera only turns on when the user
 * presses the scan button. Wrong/unknown IMEI → phone vibrates + red signal;
 * a valid one → green signal, no vibration.
 */
export function ImeiScanner({ check, onAccepted, hint }: ImeiScannerProps) {
  const { t } = useLang();
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [signal, setSignal] = useState<ImeiCheckResult | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    return () => {
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  function vibrateError() {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([120, 60, 120]);
    }
  }

  async function handleCode(raw: string) {
    const code = normalizeImei(raw);
    const now = Date.now();
    if (code === lastCodeRef.current.code && now - lastCodeRef.current.at < 2000) {
      return; // debounce repeated scans of the same barcode
    }
    lastCodeRef.current = { code, at: now };

    if (!isPlausibleImei(code)) {
      const result = { ok: false, message: t("imei_unknown") };
      setSignal(result);
      vibrateError();
      return;
    }

    let result: ImeiCheckResult;
    try {
      result = await check(code);
    } catch {
      result = { ok: false, message: t("imei_unknown") };
    }
    setSignal(result);
    if (result.ok) {
      onAccepted?.(code);
    } else {
      vibrateError();
    }
  }

  async function startScan() {
    setScanning(true);
    setSignal(null);
    try {
      // Browser-only library: dynamic import keeps it out of the SSR graph.
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("imei-scanner-region", {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.ITF,
        ],
        verbose: false,
      });
      scannerRef.current = scanner as unknown as {
        stop: () => Promise<void>;
        clear: () => void;
      };
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 170 } },
        (decodedText: string) => void handleCode(decodedText),
        () => {}, // per-frame decode failures are normal
      );
    } catch {
      setScanning(false);
      setSignal({ ok: false, message: t("camera_error") });
      vibrateError();
    }
  }

  async function stopScan() {
    const s = scannerRef.current;
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {!scanning ? (
          <button type="button" onClick={startScan} className="btn-primary btn-sm">
            <Camera className="h-4 w-4" /> {t("scan")}
          </button>
        ) : (
          <button type="button" onClick={stopScan} className="btn-outline btn-sm">
            {t("stop_scan")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="btn-outline btn-sm"
        >
          <Keyboard className="h-4 w-4" /> {t("manual_entry")}
        </button>
      </div>

      {hint ? <p className="mb-2 text-xs text-muted-foreground">{hint}</p> : null}

      {scanning ? (
        <div className="mb-2">
          <div
            id="imei-scanner-region"
            className="mx-auto max-w-sm overflow-hidden rounded-lg"
          />
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {t("scanning")}
          </p>
        </div>
      ) : null}

      {manualOpen ? (
        <div className="mb-2 flex gap-2">
          <input
            className="input"
            inputMode="numeric"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCode(manual);
                setManual("");
              }
            }}
            placeholder="IMEI"
          />
          <button
            type="button"
            className="btn-secondary btn-sm shrink-0"
            onClick={() => {
              void handleCode(manual);
              setManual("");
            }}
          >
            {t("submit")}
          </button>
        </div>
      ) : null}

      {signal ? (
        <div
          role="status"
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            signal.ok
              ? "bg-success text-success-foreground"
              : "bg-destructive text-destructive-foreground"
          }`}
        >
          {signal.message}
        </div>
      ) : null}
    </div>
  );
}
