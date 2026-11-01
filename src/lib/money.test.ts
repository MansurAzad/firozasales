import { describe, expect, it } from "vitest";

import { formatBDT, saleDue, toNumber } from "./money";

describe("money format", () => {
  it("shows the ৳ sign with English digits and western grouping", () => {
    expect(formatBDT(12500)).toBe("৳12,500");
    expect(formatBDT(1500)).toBe("৳1,500");
    expect(formatBDT(0)).toBe("৳0");
  });

  it("rounds fractional amounts and keeps negatives readable", () => {
    expect(formatBDT(1250.6)).toBe("৳1,251");
    expect(formatBDT(-500)).toBe("-৳500");
  });
});

describe("sale due rule", () => {
  it("due equals price minus cash received", () => {
    expect(saleDue(15000, 5000)).toBe(10000);
    expect(saleDue(12500, 12500)).toBe(0);
  });

  it("never goes negative when cash exceeds the total", () => {
    expect(saleDue(10000, 12000)).toBe(0);
  });
});

describe("toNumber", () => {
  it("parses numeric strings from the database and defaults to 0", () => {
    expect(toNumber("12500")).toBe(12500);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });
});
