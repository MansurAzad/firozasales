import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImeiScanner } from "./ImeiScanner";
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ t: (key: string) => key }) }));
describe("scanner input handling", () => {
  it("accepts a plausible barcode once while validation is in flight", async () => {
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
    fireEvent.change(input, { target: { value: "356789101123450" } });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    fireEvent.change(input, { target: { value: "356789101123450" } });
    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    expect(check).toHaveBeenCalledTimes(1);
    resolve?.({ ok: true, message: "OK" });
    await waitFor(() => expect(accepted).toHaveBeenCalledExactlyOnceWith("356789101123450"));
  });
});
