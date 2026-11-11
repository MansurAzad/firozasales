import { Barcode, Camera, Keyboard } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { useLang } from "@/lib/i18n";
import { extractImeiCandidates, isPlausibleImei, normalizeImei } from "@/lib/imei";

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
 * IMEI scanner for camera, USB/Bluetooth keyboard-wedge scanners and manual entry.
 * Hardware scanners behave like keyboards and usually send Enter after a scan.
 */
export function ImeiScanner({ check, onAccepted, hint }: ImeiScannerProps) {
  const { t } = useLang();
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [hardwareOpen, setHardwareOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [hardwareInput, setHardwareInput] = useState("");
  const [signal, setSignal] = useState<ImeiCheckResult | null>(null);
  const regionId = `imei-${useId().replace(/:/g, "")}`;
  const busyRef = useRef(false);
  const hardwareInputRef = useRef<HTMLInputElement>(null);
  const checkRef = useRef(check);
  const acceptedRef = useRef(onAccepted);
  checkRef.current = check;
  acceptedRef.current = onAccepted;
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  function vibrateError() {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([120, 60, 120]);
    }
  }

  async function handleCode(raw: string) {
    if (busyRef.current) return;
    const candidates = extractImeiCandidates(raw);
    if (candidates.length !== 1) {
      const result = {
        ok: false,
        message: candidates.length > 1 ? "একটি Barcode-এ একাধিক IMEI পাওয়া গেছে। একটি IMEI আলাদাভাবে Scan করুন।" : t("imei_unknown"),
      };
      setSignal(result);
      vibrateError();
      return;
    }

    const candidate = candidates[0];
    if (!candidate) return;
    const code = normalizeImei(candidate);
    const now = Date.now();
    if (code === lastCodeRef.current.code && now - lastCodeRef.current.at < 2000) {
      return;
    }
    lastCodeRef.current = { code, at: now };

    if (!isPlausibleImei(code)) {
      const result = { ok: false, message: "IMEI Format বা Check Digit সঠিক নয়" };
      setSignal(result);
      vibrateError();
      return;
    }

    busyRef.current = true;
    let result: ImeiCheckResult;
    try {
      result = await checkRef.current(code);
    } catch {
      result = { ok: false, message: t("imei_unknown") };
    } finally {
      busyRef.current = false;
    }
    setSignal(result);
    if (result.ok) {
      acceptedRef.current?.(code);
    } else {
      vibrateError();
    }
  }

  const handlersRef = useRef({ handleCode, t });
  handlersRef.current = { handleCode, t };

  useEffect(() => {
    if (!hardwareOpen) return;
    hardwareInputRef.current?.focus();
  }, [hardwareOpen]);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    let instance: { stop: () => Promise<void>; clear: () => void } | null = null;
    let started = false;
    async function release() {
      if (!instance) return;
      try {
        if (started) await instance.stop();
        instance.clear();
      } catch (error) {
        console.warn("Could not stop the IMEI scanner cleanly", error);
      }
      if (scannerRef.current === instance) scannerRef.current = null;
    }
    async function start() {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode(regionId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.PDF_417,
          ],
          verbose: false,
        });
        instance = scanner;
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (width: number, height: number) => ({
              width: Math.min(260, Math.floor(width * 0.85)),
              height: Math.min(170, Math.floor(height * 0.7)),
            }),
          },
          (text: string) => {
            if (!cancelled) void handlersRef.current.handleCode(text);
          },
          () => {},
        );
        started = true;
        if (cancelled) await release();
      } catch {
        await release();
        if (!cancelled) {
          setScanning(false);
          setSignal({ ok: false, message: handlersRef.current.t("camera_error") });
          vibrateError();
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      if (started) void release();
    };
  }, [scanning, regionId]);

  function startScan() {
    setSignal(null);
    setScanning(true);
  }
  function stopScan() {
    setScanning(false);
  }

  function submitHardwareScan() {
    const value = hardwareInput;
    setHardwareInput("");
    void handleCode(value);
    requestAnimationFrame(() => hardwareInputRef.current?.focus());
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {!scanning ? (
          <Button type="button" onClick={startScan} className="btn-primary btn-sm">
            <Camera className="h-4 w-4" /> {t("scan")}
          </Button>
        ) : (
          <Button type="button" onClick={stopScan} className="btn-outline btn-sm">
            {t("stop_scan")}
          </Button>
        )}
        <Button
          type="button"
          onClick={() => {
            setHardwareOpen((v) => !v);
            setSignal(null);
          }}
          className="btn-outline btn-sm"
          aria-expanded={hardwareOpen}
        >
          <Barcode className="h-4 w-4" /> USB / Bluetooth
        </Button>
        <Button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="btn-outline btn-sm"
          aria-expanded={manualOpen}
        >
          <Keyboard className="h-4 w-4" /> {t("manual_entry")}
        </Button>
      </div>

      {hint ? <p className="mb-2 text-xs text-muted-foreground">{hint}</p> : null}

      {hardwareOpen ? (
        <div className="mb-2 rounded-lg border border-border bg-background p-2">
          <label htmlFor={`${regionId}-hardware`} className="mb-1 block text-xs font-medium">
            Hardware Barcode Scanner — Scan করে Enter চাপুন
          </label>
          <input
            ref={hardwareInputRef}
            id={`${regionId}-hardware`}
            className="input w-full"
            value={hardwareInput}
            onChange={(e) => setHardwareInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitHardwareScan();
              }
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="none"
            placeholder="USB / Bluetooth Scanner Ready"
            aria-label="USB / Bluetooth barcode scanner input"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Scanner-টি Keyboard-এর মতো কাজ করবে। Scan Input-এ Focus রেখে ধারাবাহিকভাবে Scan করুন।
          </p>
        </div>
      ) : null}

      {scanning ? (
        <div className="mb-2">
          <div id={regionId} className="mx-auto max-w-sm overflow-hidden rounded-lg" />
          <p className="mt-1 text-center text-xs text-muted-foreground">{t("scanning")}</p>
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
            aria-label="IMEI"
            placeholder="IMEI"
          />
          <Button
            type="button"
            className="btn-secondary btn-sm shrink-0"
            onClick={() => {
              void handleCode(manual);
              setManual("");
            }}
          >
            {t("submit")}
          </Button>
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
