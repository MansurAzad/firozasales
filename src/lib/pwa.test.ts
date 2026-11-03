import { describe, expect, it } from "vitest";
import { refuseServiceWorker } from "./pwa";
describe("offline worker safety", () => {
  it("refuses development, framed and explicitly disabled registration", () => {
    expect(refuseServiceWorker("firozasales.lovable.app", false, false, false)).toBe(true);
    expect(refuseServiceWorker("firozasales.lovable.app", true, true, false)).toBe(true);
    expect(refuseServiceWorker("firozasales.lovable.app", true, false, true)).toBe(true);
  });
  it("refuses preview domains but allows published and custom domains", () => {
    for (const host of [
      "id-preview--project.lovable.app",
      "preview-2--project.gpt-eng.com",
      "project--project-dev.lovable.app",
      "foo.lovableproject.com",
      "foo.beta.lovable.dev",
    ])
      expect(refuseServiceWorker(host, true, false, false)).toBe(true);
    for (const host of [
      "firozasales.lovable.app",
      "sales.example.com",
      "preview-v2--shop.example.com",
    ])
      expect(refuseServiceWorker(host, true, false, false)).toBe(false);
  });
});
