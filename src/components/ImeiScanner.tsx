import { Camera, Keyboard, Lightbulb, Minus, Plus, ScanLine, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { hasValidImeiChecksum, normalizeImei } from "@/lib/imei";

export interface ImeiCheckResult {
  ok: boolean;
  message: string;
}
export type ImeiScanSource = "mobile_camera" | "webcam" | "usb_scanner" | "manual";
export type ImeiScanOutcome =
  | "accepted"
  | "invalid_format"
  | "invalid_checksum"
  | "duplicate"
  | "error";
export interface ImeiScanEvent {
  imei: string;
  source: ImeiScanSource;
  outcome: ImeiScanOutcome;
  message: string;
}
interface ImeiScannerProps {
  check: (code: string) => ImeiCheckResult | Promise<ImeiCheckResult>;
  onAccepted?: (code: string) => void;
  onScanEvent?: (event: ImeiScanEvent) => void | Promise<void>;
  hint?: string;
}

interface BarcodeDetectorResult {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<BarcodeDetectorResult[]>;
}
interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}
interface ZXingReader {
  readBarcodes(
    image: ImageData,
    options: {
      formats: string[];
      tryHarder: boolean;
      tryRotate: boolean;
      tryInvert: boolean;
      maxNumberOfSymbols: number;
    },
  ): Promise<Array<{ text: string }>>;
}
type CameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  zoom?: { min: number; max: number; step?: number };
  torch?: boolean;
};

const SCAN_FORMATS = ["code_128", "code_39", "itf", "codabar"];
const ZXING_FORMATS = ["Code128", "Code39", "ITF", "Codabar"];

function sharpenImageData(image: ImageData): ImageData {
  const { data, width, height } = image;
  const original = new Uint8ClampedArray(data);
  const stride = width * 4;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          original[index + channel] * 5 -
          original[index - 4 + channel] -
          original[index + 4 + channel] -
          original[index - stride + channel] -
          original[index + stride + channel];
        data[index + channel] = Math.max(0, Math.min(255, value));
      }
    }
  }
  return image;
}

function playSuccessBeep() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 1046;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    void context.resume();
    oscillator.start();
    oscillator.stop(context.currentTime + 0.13);
    oscillator.onended = () => void context.close();
  } catch {
    // Audio is best-effort; scanning and validation must not depend on it.
  }
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export function ImeiScanner({ check, onAccepted, onScanEvent, hint }: ImeiScannerProps) {
  const { t, lang } = useLang();
  const bn = lang === "bn";
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [usbValue, setUsbValue] = useState("");
  const [signal, setSignal] = useState<ImeiCheckResult | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState<{ min: number; max: number; step: number } | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [roiPercent, setRoiPercent] = useState(92);
  const [engine, setEngine] = useState("—");
  const regionId = "imei-camera-" + useId().replace(/:/g, "");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const scanQueueRef = useRef<Array<{ raw: string; source: ImeiScanSource }>>([]);
  const acceptedInQueueRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const checkRef = useRef(check);
  const acceptedRef = useRef(onAccepted);
  const eventRef = useRef(onScanEvent);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const zxingRef = useRef<Promise<ZXingReader> | null>(null);
  const roiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  checkRef.current = check;
  acceptedRef.current = onAccepted;
  eventRef.current = onScanEvent;

  const record = useCallback((event: ImeiScanEvent) => {
    void Promise.resolve(eventRef.current?.(event)).catch((error) => {
      console.warn("Could not save IMEI scan history", error);
    });
  }, []);

  const handleCode = useCallback(async (raw: string, source: ImeiScanSource) => {
    const code = normalizeImei(raw);
    if (!code) return;
    const now = Date.now();
    // Suppress repeated camera frames briefly, but never hide a deliberate USB/manual rescan.
    if (
      (source === "mobile_camera" || source === "webcam") &&
      code === lastCodeRef.current.code &&
      now - lastCodeRef.current.at < 1300
    ) return;
    lastCodeRef.current = { code, at: now };
    scanQueueRef.current.push({ raw: code, source });
    if (busyRef.current) return;

    busyRef.current = true;
    try {
      while (scanQueueRef.current.length) {
        const next = scanQueueRef.current.shift();
        if (!next) continue;
        const nextCode = normalizeImei(next.raw);

        if (!/^\d{15}$/.test(nextCode)) {
          const message = bn ? "IMEI অবশ্যই ১৫ সংখ্যার হতে হবে" : "IMEI must contain exactly 15 digits";
          setSignal({ ok: false, message });
          record({ imei: nextCode, source: next.source, outcome: "invalid_format", message });
          vibrate([90, 50, 90]);
          continue;
        }
        if (!hasValidImeiChecksum(nextCode)) {
          const message = bn ? "IMEI Luhn Checksum সঠিক নয়" : "Invalid IMEI Luhn checksum";
          setSignal({ ok: false, message });
          record({ imei: nextCode, source: next.source, outcome: "invalid_checksum", message });
          vibrate([90, 50, 90]);
          continue;
        }

        if (acceptedInQueueRef.current.has(nextCode)) {
          const message = bn ? "এই স্ক্যানে IMEI ইতিমধ্যে গ্রহণ করা হয়েছে" : "IMEI already accepted in this scan batch";
          setSignal({ ok: false, message });
          record({ imei: nextCode, source: next.source, outcome: "duplicate", message });
          vibrate([120, 60, 120]);
          continue;
        }

        let result: ImeiCheckResult;
        try {
          result = await checkRef.current(nextCode);
        } catch (error) {
          result = {
            ok: false,
            message: error instanceof Error ? error.message : (bn ? "যাচাই করা যায়নি" : "Could not verify IMEI"),
          };
        }
        if (!mountedRef.current) return;
        setSignal(result);
        if (result.ok) {
          acceptedInQueueRef.current.add(nextCode);
          record({ imei: nextCode, source: next.source, outcome: "accepted", message: result.message });
          acceptedRef.current?.(nextCode);
          playSuccessBeep();
          vibrate(45);
        } else {
          const duplicate = /duplicate|already|আগে|ডুপ্লিকেট/i.test(result.message);
          record({
            imei: nextCode,
            source: next.source,
            outcome: duplicate ? "duplicate" : "error",
            message: result.message,
          });
          vibrate([120, 60, 120]);
        }
      }
    } finally {
      acceptedInQueueRef.current.clear();
      busyRef.current = false;
    }
  }, [bn, record]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    setTorchOn(false);
    setZoomRange(null);
    setTorchAvailable(false);
  }, []);

  const applyCameraControls = useCallback(async (track: MediaStreamTrack) => {
    const capabilities =
      typeof track.getCapabilities === "function"
        ? (track.getCapabilities() as CameraCapabilities)
        : ({} as CameraCapabilities);
    const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
    const zoomCap = capabilities.zoom;
    if (zoomCap) {
      setZoomRange({ min: zoomCap.min, max: zoomCap.max, step: zoomCap.step ?? 0.1 });
      setZoom(Math.min(zoomCap.max, Math.max(zoomCap.min, settings.zoom ?? zoomCap.min)));
    }
    setTorchAvailable(Boolean(capabilities.torch));
    const advanced: Record<string, unknown>[] = [];
    if (capabilities.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
    if (capabilities.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" });
    if (advanced.length) {
      try {
        await track.applyConstraints({ advanced } as MediaTrackConstraints);
      } catch {
        // Device-specific controls are optional.
      }
    }
  }, []);

  const setZoomLevel = useCallback(async (nextZoom: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !zoomRange) return;
    const value = Math.max(zoomRange.min, Math.min(zoomRange.max, nextZoom));
    try {
      await track.applyConstraints({
        advanced: [{ zoom: value } as MediaTrackConstraintSet],
      } as MediaTrackConstraints);
      setZoom(value);
    } catch {
      setSignal({ ok: false, message: bn ? "এই ক্যামেরায় Zoom সমর্থিত নয়" : "Zoom is not supported by this camera" });
    }
  }, [bn, zoomRange]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchAvailable) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      } as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setSignal({ ok: false, message: bn ? "এই ক্যামেরায় Torch সমর্থিত নয়" : "Torch is not supported by this camera" });
    }
  }, [bn, torchAvailable, torchOn]);

  const startCamera = useCallback(async () => {
    setSignal(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable");
      video.srcObject = stream;
      await video.play();
      await applyCameraControls(stream.getVideoTracks()[0]);
      setScanning(true);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setSignal({
        ok: false,
        message: error instanceof Error ? error.message : (bn ? "ক্যামেরা চালু করা যায়নি" : "Could not start camera"),
      });
      vibrate([100, 60, 100]);
    }
  }, [applyCameraControls, bn]);

  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let timer = 0;
    let frameBusy = false;
    let frameNumber = 0;
    let nativeDetector: BarcodeDetectorLike | null = null;
    let useNative = false;

    async function loadZXing() {
      if (!zxingRef.current) {
        zxingRef.current = import("zxing-wasm/reader").then(async (module) => {
          await module.prepareZXingModule({
            overrides: {
              locateFile: (path: string, prefix: string) =>
                path.endsWith(".wasm") ? wasmUrl : prefix + path,
            },
            fireImmediately: true,
          });
          return { readBarcodes: module.readBarcodes as ZXingReader["readBarcodes"] };
        });
      }
      return zxingRef.current;
    }

    async function setupDetector() {
      const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (Detector) {
        try {
          const formats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : SCAN_FORMATS;
          const supported = SCAN_FORMATS.filter((format) => formats.includes(format));
          if (supported.length) {
            nativeDetector = new Detector({ formats: supported });
            useNative = true;
            setEngine("Native BarcodeDetector");
          }
        } catch {
          nativeDetector = null;
        }
      }
      if (!useNative) {
        try {
          await loadZXing();
          if (!cancelled) setEngine("ZXing-C++ WASM");
        } catch {
          if (!cancelled) setSignal({
            ok: false,
            message: bn ? "Barcode decoder লোড করা যায়নি" : "Could not load barcode decoder",
          });
        }
      }
    }

    async function decodeFrame() {
      if (cancelled || frameBusy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      frameBusy = true;
      frameNumber += 1;
      try {
        if (nativeDetector) {
          const found = await nativeDetector.detect(video);
          if (found[0]?.rawValue) {
            const facingMode = streamRef.current?.getVideoTracks()[0]?.getSettings().facingMode;
            await handleCode(found[0].rawValue, facingMode === "environment" ? "mobile_camera" : "webcam");
            return;
          }
        }
        // Crop a wide, adjustable region, then upscale it for tiny printed labels.
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        const cropWidth = Math.max(1, Math.floor(sourceWidth * (roiPercent / 100)));
        const cropHeight = Math.max(1, Math.floor(sourceHeight * 0.76));
        const sx = Math.floor((sourceWidth - cropWidth) / 2);
        const sy = Math.floor((sourceHeight - cropHeight) / 2);
        const baseCanvas = baseCanvasRef.current ?? document.createElement("canvas");
        baseCanvasRef.current = baseCanvas;
        baseCanvas.width = cropWidth;
        baseCanvas.height = cropHeight;
        const baseContext = baseCanvas.getContext("2d", { willReadFrequently: true });
        if (!baseContext) return;
        baseContext.filter = "contrast(1.32) brightness(1.04) grayscale(1)";
        baseContext.drawImage(video, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        // Apply a light unsharp mask every third frame to improve tiny printed bar edges.
        if (frameNumber % 3 === 0) {
          const baseImage = baseContext.getImageData(0, 0, cropWidth, cropHeight);
          baseContext.putImageData(sharpenImageData(baseImage), 0, 0);
        }

        const canvas = roiCanvasRef.current ?? document.createElement("canvas");
        roiCanvasRef.current = canvas;
        const scale = frameNumber % 3 === 0 ? 2.4 : frameNumber % 2 === 0 ? 1.7 : 1.25;
        canvas.width = Math.floor(cropWidth * scale);
        canvas.height = Math.floor(cropHeight * scale);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.imageSmoothingEnabled = false;
        context.drawImage(baseCanvas, 0, 0, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const reader = await loadZXing();
        const results = await reader.readBarcodes(image, {
          formats: ZXING_FORMATS,
          tryHarder: true,
          tryRotate: true,
          tryInvert: true,
          maxNumberOfSymbols: 1,
        });
        if (results[0]?.text) {
          const facingMode = streamRef.current?.getVideoTracks()[0]?.getSettings().facingMode;
          await handleCode(results[0].text, facingMode === "environment" ? "mobile_camera" : "webcam");
        }
      } catch {
        // A bad frame is normal while autofocus/exposure settles; keep sampling.
      } finally {
        frameBusy = false;
        if (!cancelled) timer = window.setTimeout(() => void decodeFrame(), 110);
      }
    }

    void setupDetector().then(() => {
      if (!cancelled) void decodeFrame();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scanning, roiPercent, handleCode, bn]);

  const submitUsb = useCallback(() => {
    if (!usbValue.trim()) return;
    void handleCode(usbValue, "usb_scanner");
    setUsbValue("");
  }, [handleCode, usbValue]);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {!scanning ? (
          <Button type="button" onClick={() => void startCamera()} className="btn-primary btn-sm">
            <Camera className="h-4 w-4" /> {t("scan")}
          </Button>
        ) : (
          <Button type="button" onClick={stopCamera} className="btn-outline btn-sm">
            <X className="h-4 w-4" /> {t("stop_scan")}
          </Button>
        )}
        <Button type="button" onClick={() => setManualOpen((value) => !value)} className="btn-outline btn-sm">
          <Keyboard className="h-4 w-4" /> {t("manual_entry")}
        </Button>
      </div>

      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

      <div className="space-y-1">
        <label className="text-xs font-semibold">{bn ? "USB বারকোড স্ক্যানার" : "USB barcode scanner"}</label>
        <div className="flex gap-2">
          <input
            className="input min-w-0"
            value={usbValue}
            onChange={(event) => setUsbValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitUsb();
              }
            }}
            placeholder={bn ? "স্ক্যানার সংযুক্ত করে এখানে ক্লিক করুন" : "Connect scanner and focus this field"}
            aria-label="USB IMEI scanner input"
            autoComplete="off"
          />
          <Button type="button" className="btn-secondary btn-sm shrink-0" onClick={submitUsb}>
            {bn ? "গ্রহণ" : "Submit"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {bn ? "USB HID / Keyboard Wedge স্ক্যানার Enter suffix দিয়ে ধারাবাহিক স্ক্যান করতে পারবে।" : "USB HID / Keyboard Wedge scanners can send continuous scans with an Enter suffix."}
        </p>
      </div>

      <div className={`space-y-2 ${scanning ? "" : "hidden"}`}>
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="block max-h-[420px] w-full object-contain" playsInline muted />
            <div className="pointer-events-none absolute top-1/2 h-[76%] -translate-y-1/2 rounded-md border-2 border-emerald-400/90 shadow-[0_0_0_999px_rgba(0,0,0,0.25)]" style={{ left: `${(100 - roiPercent) / 2}%`, width: `${roiPercent}%` }} />
            <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">{engine}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {torchAvailable ? (
              <Button type="button" variant="outline" className="btn-sm" onClick={() => void toggleTorch()}>
                <Lightbulb className="h-4 w-4" /> {torchOn ? (bn ? "টর্চ বন্ধ" : "Torch off") : (bn ? "টর্চ চালু" : "Torch on")}
              </Button>
            ) : null}
            {zoomRange ? (
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" className="btn-sm" onClick={() => void setZoomLevel(zoom - zoomRange.step)}><Minus className="h-3 w-3" /></Button>
                <span className="text-xs tabular-nums">{zoom.toFixed(1)}×</span>
                <Button type="button" variant="outline" className="btn-sm" onClick={() => void setZoomLevel(zoom + zoomRange.step)}><Plus className="h-3 w-3" /></Button>
              </div>
            ) : null}
            <label className="flex min-w-36 flex-1 items-center gap-2 text-xs">
              <ScanLine className="h-4 w-4 shrink-0" />
              {bn ? "স্ক্যান এরিয়া" : "Scan area"}
              <input
                className="min-w-16 flex-1"
                type="range"
                min="60"
                max="100"
                step="2"
                value={roiPercent}
                onChange={(event) => setRoiPercent(Number(event.target.value))}
                aria-label={bn ? "স্ক্যান এরিয়া" : "Scan area"}
              />
              <span className="tabular-nums">{roiPercent}%</span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{bn ? "ক্যামেরা: 1080p আদর্শ; ডিভাইস সমর্থন করলে continuous autofocus, zoom ও torch চালু হবে।" : "Camera: 1080p ideal; continuous autofocus, zoom and torch are enabled when supported."}</p>
      </div>

      {manualOpen ? (
        <div className="flex gap-2">
          <input
            className="input min-w-0"
            inputMode="numeric"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleCode(manual, "manual");
                setManual("");
              }
            }}
            aria-label="IMEI"
            placeholder="IMEI"
          />
          <Button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => {
            void handleCode(manual, "manual");
            setManual("");
          }}>{t("submit")}</Button>
        </div>
      ) : null}

      {signal ? (
        <div role="status" aria-live="polite" className={`rounded-lg px-3 py-2 text-sm font-semibold ${signal.ok ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}`}>
          {signal.message}
        </div>
      ) : null}
    </div>
  );
}
