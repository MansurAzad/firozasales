import { describe, expect, it } from "vitest";

import { checkTransition, isPlausibleImei, normalizeImei } from "./imei";

describe("IMEI normalization", () => {
  it("strips non-digits from scanned barcode text", () => {
    expect(normalizeImei("  35-678910-112345\n")).toBe("35678910112345");
  });

  it("accepts 14–16 digit codes and rejects anything else", () => {
    expect(isPlausibleImei("35678910112345")).toBe(true); // 14
    expect(isPlausibleImei("356789101123450")).toBe(true); // 15
    expect(isPlausibleImei("3567891011234501")).toBe(true); // 16
    expect(isPlausibleImei("123")).toBe(false);
    expect(isPlausibleImei("")).toBe(false);
  });
});

describe("IMEI status flow (mirrors database functions)", () => {
  it("rejects an unknown IMEI on every action", () => {
    for (const action of ["issue", "sell", "return"] as const) {
      expect(checkTransition(action, null)).toEqual({
        ok: false,
        reason: "unknown_imei",
      });
    }
  });

  it("issues only from dealer stock", () => {
    expect(checkTransition("issue", "in_dealer_stock").ok).toBe(true);
    expect(checkTransition("issue", "with_salesman")).toEqual({
      ok: false,
      reason: "wrong_status",
    });
    expect(checkTransition("issue", "sold")).toEqual({
      ok: false,
      reason: "wrong_status",
    });
  });

  it("sells only a unit the salesman already carries", () => {
    expect(checkTransition("sell", "with_salesman").ok).toBe(true);
    expect(checkTransition("sell", "in_dealer_stock").ok).toBe(false);
    expect(checkTransition("sell", "sold").ok).toBe(false);
  });

  it("returns only a carried unit back to dealer stock", () => {
    expect(checkTransition("return", "with_salesman").ok).toBe(true);
    expect(checkTransition("return", "in_dealer_stock").ok).toBe(false);
    expect(checkTransition("return", "sold").ok).toBe(false);
  });

  it("full lifecycle: issue → sell → return path stays closed for sold units", () => {
    expect(checkTransition("issue", "in_dealer_stock").ok).toBe(true);
    expect(checkTransition("sell", "with_salesman").ok).toBe(true);
    // A sold unit can never be returned through the scanner flow.
    expect(checkTransition("return", "sold").ok).toBe(false);
  });
});
