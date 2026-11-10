import { describe, expect, it } from "vitest";

import {
  checkTransition,
  hasValidImeiChecksum,
  isPlausibleImei,
  normalizeImei,
} from "./imei";

describe("IMEI normalization", () => {
  it("strips separators from scanned barcode text", () => {
    expect(normalizeImei("  49-015420-3237518 ")).toBe("490154203237518");
  });
});

describe("strict IMEI validation", () => {
  it("accepts a valid 15-digit IMEI with a valid Luhn check digit", () => {
    expect(hasValidImeiChecksum("490154203237518")).toBe(true);
    expect(isPlausibleImei("490154203237518")).toBe(true);
  });

  it("rejects a 15-digit IMEI with an invalid check digit", () => {
    expect(hasValidImeiChecksum("490154203237519")).toBe(false);
    expect(isPlausibleImei("490154203237519")).toBe(false);
  });

  it("rejects 14-digit, 16-digit, non-digit, and empty values", () => {
    for (const value of ["49015420323751", "4901542032375180", "12345678901234a", ""]) {
      expect(isPlausibleImei(value)).toBe(false);
    }
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
    expect(checkTransition("return", "sold").ok).toBe(false);
  });
});
