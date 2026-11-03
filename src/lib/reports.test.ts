import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import type { AccountingSnapshot } from "./accounting";
import { buildDocument, buildReport, inDateRange, reference } from "./reports";
import { businessDateKey } from "./business-time";
const d: AccountingSnapshot = {
  profiles: [{ id: "u", full_name: "SR", is_active: true, created_at: "" }],
  roles: [{ id: "role", user_id: "u", role: "salesman" }],
  products: [
    {
      id: "b",
      name: "Button phone",
      category: "button_phone",
      price: 2500,
      model: "",
      created_at: "",
      is_active: true,
    },
  ],
  retailers: [{ id: "r", name: "Dealer", phone: "", address: "", is_active: true, created_at: "" }],
  imeiUnits: [],
  sales: [
    {
      id: "s",
      retailer_id: "r",
      salesman_id: "u",
      total_amount: 31000,
      paid_amount: 20000,
      sold_at: "2026-11-01T06:00:00Z",
      note: "",
    },
  ],
  saleItems: [
    { id: "i", sale_id: "s", product_id: "b", quantity: 2, unit_price: 2500, imei_unit_id: null },
  ],
  payments: [
    {
      id: "p",
      retailer_id: "r",
      salesman_id: "u",
      amount: 3000,
      paid_at: "2026-11-01T07:00:00Z",
      note: "",
    },
  ],
  deposits: [],
  returns: [],
  settlements: [],
  stockIssues: [],
  issueItems: [],
  inventoryReceipts: [
    {
      id: "rc",
      received_by: "u",
      source: "purchase",
      supplier: "Supplier",
      note: "",
      received_at: "2026-10-31T20:00:00Z",
    },
  ],
  inventoryReceiptItems: [
    {
      id: "rci",
      receipt_id: "rc",
      product_id: "b",
      quantity: 3,
      unit_cost: 250,
      created_at: "2026-10-31T20:00:00Z",
    },
  ],
  dealerReturns: [],
  dealerReturnItems: [],
  transactionReversals: [],
};
const f = { from: "", to: "", sr: "", dealer: "" };
const creditSnapshot: AccountingSnapshot = {
  ...d,
  dealerReturns: [
    {
      id: "credit",
      sale_id: "s",
      retailer_id: "r",
      salesman_id: "u",
      created_by: "u",
      total_amount: 200,
      refund_amount: 100,
      credit_amount: 100,
      note: "Returned stock",
      created_at: "2026-11-02T06:00:00Z",
    },
  ],
  dealerReturnItems: [],
};
describe("business document accounting", () => {
  it("exports button phones without an IMEI at the actual quantity and rate", () =>
    expect(buildDocument(d, "invoice", "s")?.rows).toEqual([["Button phone", "—", 2, 2500, 5000]]));
  it("keeps invoice due at 11000 instead of applying later collections to the original invoice", () =>
    expect(buildDocument(d, "invoice", "s")?.totals[2]?.[1]).toBe(11000));
  it("keeps dealer closing due at 8000 after later collection", () =>
    expect(buildReport(d, "dealers", f).rows[0]?.[5]).toBe(8000));
  it("keeps running ledger due at 11000 then 8000", () =>
    expect(buildReport(d, "ledger", f).rows.map((r) => r[6])).toEqual([11000, 8000]));
  it("exports the actual 3000 collection receipt", () =>
    expect(buildDocument(d, "receipt", "p")?.totals[0]?.[1]).toBe(3000));
  it("does not invent a document for a missing transaction", () =>
    expect(buildDocument(d, "invoice", "unknown")).toBeNull());
  it("filters each SR rather than exporting unrelated sales", () =>
    expect(buildReport(d, "sales", { ...f, sr: "other" }).rows).toEqual([]));
  it("includes both date boundaries and excludes earlier dates", () => {
    expect(inDateRange("2026-11-01T07:00:00Z", "2026-11-01", "2026-11-01")).toBe(true);
    expect(inDateRange("2026-10-31T07:00:00Z", "2026-11-01", "2026-11-01")).toBe(false);
  });
  it("uses Dhaka business dates rather than UTC calendar dates", () => {
    expect(businessDateKey("2026-10-31T20:00:00Z")).toBe("2026-11-01");
    expect(inDateRange("2026-10-31T20:00:00Z", "2026-11-01", "2026-11-01")).toBe(true);
  });
  it("exports recorded procurement unit cost and total for Dhaka-date filters", () =>
    expect(
      buildReport(d, "procurement", { ...f, from: "2026-11-01", to: "2026-11-01" }).rows[0]?.slice(
        4,
        8,
      ),
    ).toEqual(["Button phone", 3, 250, 750]));
  it("reports the original invoice and separates return value, cash refund, and balance credit", () => {
    const row = buildReport(creditSnapshot, "credit_notes", f).rows[0];
    expect(row?.[2]).toBe(reference("INV", "s"));
    expect(row?.slice(5, 8)).toEqual([200, 100, 100]);
  });
});
