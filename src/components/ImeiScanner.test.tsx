import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImeiScanner } from "./ImeiScanner";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ t: (key: string) => key }) }));

describe("scanner input handling", () => {
  it("accepts a valid IMEI once while validation is in flight", async () => {
    let resolve: ((value: { ok: boolean; message: string }) => void) | undefined;
    const check = vi.fn(
        () =>
          new Promise<{ ok: boolean; message: string }>((r) => {
            resolve = r;
          }),
      ),
      accepted = vi.fn();
    render(<ImeiScanner check={check} onAccepted={accepted} />);
    fireEvent.click(screen.getByRole("button", { name: "manual_entry" }));
    const input = screen.getByRole("textbox", { name: "IMEI" });
    fireEvent.change(input, { target: { value: "490154203237518" } });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    fireEvent.change(input, { target: { value: "490154203237518" } });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    expect(check).toHaveBeenCalledTimes(1);
    resolve?.({ ok: true, message: "OK" });
    await waitFor(() => expect(accepted).toHaveBeenCalledExactlyOnceWith("490154203237518"));
  });

  it("supports USB/Bluetooth keyboard-wedge scanners ending with Enter", async () => {
    const check = vi.fn().mockResolvedValue({ ok: true, message: "OK" });
    const accepted = vi.fn();
    render(<ImeiScanner check={check} onAccepted={accepted} />);
    fireEvent.click(screen.getByRole("button", { name: /USB \/ Bluetooth/ }));
    const input = screen.getByRole("textbox", { name: "USB / Bluetooth barcode scanner input" });
    fireEvent.change(input, { target: { value: "490154203237518" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(accepted).toHaveBeenCalledWith("490154203237518"));
  });
});
