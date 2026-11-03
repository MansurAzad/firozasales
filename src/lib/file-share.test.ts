import { afterEach, describe, expect, it, vi } from "vitest";
import { canShareFile, shareFile } from "./file-share";
const file = new File(["private report"], "FE-sales.pdf", { type: "application/pdf" });
afterEach(() => vi.unstubAllGlobals());
describe("private document sharing", () => {
  it("shares only the prepared file and title, without a public URL", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { canShare: () => true, share });
    expect(await shareFile(file, "Sales")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file], title: "Sales" });
  });
  it("offers fallback when file sharing is unsupported without invoking share", async () => {
    const share = vi.fn();
    vi.stubGlobal("navigator", { canShare: () => false, share });
    expect(await shareFile(file, "Sales")).toBe("unavailable");
    expect(share).not.toHaveBeenCalled();
  });
  it("treats user cancellation separately and does not retry", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    vi.stubGlobal("navigator", { canShare: () => true, share });
    expect(await shareFile(file, "Sales")).toBe("cancelled");
    expect(share).toHaveBeenCalledTimes(1);
  });
  it("offers fallback for blocked browser permissions", async () => {
    vi.stubGlobal("navigator", {
      canShare: () => true,
      share: vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError")),
    });
    expect(await shareFile(file, "Sales")).toBe("unavailable");
  });
  it("handles missing and throwing capability checks", () => {
    vi.stubGlobal("navigator", {});
    expect(canShareFile(file)).toBe(false);
    vi.stubGlobal("navigator", {
      share: vi.fn(),
      canShare: () => {
        throw new Error("blocked");
      },
    });
    expect(canShareFile(file)).toBe(false);
  });
});
