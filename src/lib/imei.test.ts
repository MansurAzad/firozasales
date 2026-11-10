import { describe, expect, it } from "vitest";

import {
  checkTransition,
  extractImeiCandidates,
  isPlausibleImei,
  isValidImeiCheckDigit,
  normalizeImei,
} from "./imei";

describe("IMEI parsing and validation", () => {
  it("accepts valid 15-digit IMEI and rejects an invalid check digit", () => {
    expect(isValidImeiCheckDigit("490154203237518")).toBe(true);
    expect(isPlausibleImei("490154203237518")).toBe(true);
    expect(isValidImeiCheckDigit("490154203237519")).toBe(false);
    expect(isPlausibleImei("490154203237519")).toBe(false);
  });

  it("parses one labelled IMEI without joining unrelated label numbers", () => {
    expect(normalizeImei("IMEI1: 490154203237518")).toBe("490154203237518");
    expect(normalizeImei("  35-678910-112345\n")).toBe("35678910112345");
  });

  it("returns separate candidates when a label contains IMEI1 and IMEI2", () => {
    expect(extractImeiCandidates("IMEI1: 490154203237518 IMEI2: 490154203237526")).toEqual([
      "490154203237518",
      "490154203237526",
    ]);
    expect(normalizeImei("IMEI1: 490154203237518 IMEI2: 490154203237526")).toBe("");
  });

  it("retains 14-digit legacy identifiers and 16-digit IMEISV values for exact lookup", () => {
    expect(isPlausibleImei("35678910112345")).toBe(true);
    expect(isPlausibleImei("1234567890123456")).toBe(true);
  });

  it("rejects short or malformed values", () => {
    expect(isPlausibleImei("123")).toBe(false);
    expect(isPlausibleImei("")).toBe(false);
    expect(extractImeiCandidates("SN-ABC-12345")).toEqual([]);
  });
});

describe("IMEI status flow (mirrors database functions)", () => {
  it("rejects an unknown IMEI on every action", () => {
    for (const action of ["issue", "sell", "return"] as const) {
      expect(checkTransition(action, null)).toEqual({ ok: false, reason: "unknown_imei" });
    }
  });

  it("issues only from dealer stock", () => {
    expect(checkTransition("issue", "in_dealer_stock").ok).toBe(true);
    expect(checkTransition("issue", "with_salesman").reason).toBe("wrong_status");
    expect(checkTransition("issue", "sold").reason).toBe("wrong_status");
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
});
