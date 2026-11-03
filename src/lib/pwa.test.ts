import { describe, expect, it } from "vitest";
import { refuseServiceWorker } from "./pwa";
describe("offline worker safety", () => {
  it("refuses development, framed and explicitly disabled registration", () => {
    expect(refuseServiceWorker(false, false, false)).toBe(true);
    expect(refuseServiceWorker(true, true, false)).toBe(true);
    expect(refuseServiceWorker(true, false, true)).toBe(true);
  });
  it("allows production registration on deployment and custom domains", () => {
    expect(refuseServiceWorker(true, false, false)).toBe(false);
  });
});
