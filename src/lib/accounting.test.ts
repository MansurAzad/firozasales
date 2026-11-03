import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
import { dealerDues, validCash } from "./accounting";
import { perProductStock, summarizeSalesman, type SalesmanData } from "./hisab";
const data: SalesmanData = {
  products: [],
  retailers: [],
  sales: [{ id: "s", retailer_id: "r", total_amount: 31000, paid_amount: 20000, sold_at: "" }],
  payments: [{ id: "p", retailer_id: "r", amount: 3000, paid_at: "", note: "" }],
  deposits: [{ id: "d", settlement_id: null, amount: 15000, deposited_at: "", note: "" }],
  returns: [],
  issues: [],
  issueItems: [],
  saleItems: [],
  imeiUnits: [],
  dealerReturns: [],
  dealerReturnItems: [],
};
describe("SR and dealer balances", () => {
  it("keeps 31000 less 20000 cash and 3000 collection as 8000 due", () =>
    expect(summarizeSalesman(data).dues).toBe(8000));
  it("keeps cash on hand as 8000 after 23000 collection and 15000 deposit", () =>
    expect(summarizeSalesman(data).cashOnHand).toBe(8000));
  it("subtracts cash refunds from the SR balance", () =>
    expect(
      summarizeSalesman({
        ...data,
        dealerReturns: [
          {
            id: "return",
            retailer_id: "r",
            salesman_id: "sr",
            total_amount: 500,
            refund_amount: 200,
            credit_amount: 300,
            note: "",
            created_at: "",
          },
        ],
      }).cashOnHand,
    ).toBe(7800));
  it("never lets a dealer credit erase another dealer debt", () =>
    expect(
      dealerDues(
        [{ retailer_id: "a", total_amount: 100, paid_amount: 0 }],
        [{ retailer_id: "b", amount: 500 }],
      ),
    ).toBe(100));
  it("reduces dealer due by the remaining credit and not by a cash refund twice", () =>
    expect(
      dealerDues(
        [{ retailer_id: "a", total_amount: 500, paid_amount: 200 }],
        [],
        [{ retailer_id: "a", credit_amount: 100 }],
      ),
    ).toBe(200));
  it("rejects a payment above the 8000 due", () => {
    expect(validCash(8000.01, 8000)).toBe(false);
    expect(validCash(8000, 8000)).toBe(true);
  });
  it("rejects cash above the 31000 sale amount", () => {
    expect(validCash(31001, 31000, true)).toBe(false);
    expect(validCash(0, 31000, true)).toBe(true);
  });
  it("rejects nonfinite and sub-paisa amounts", () => {
    expect(validCash(Infinity, 8000)).toBe(false);
    expect(validCash(1.001, 8000)).toBe(false);
  });
  it("keeps remaining quantity at 2 after 5 issued, 1 sold and 2 returned", () => {
    const row = perProductStock({
      ...data,
      issueItems: [{ id: "i", issue_id: "h", product_id: "q", quantity: 5, imei_unit_id: null }],
      saleItems: [{ id: "s", sale_id: "s", product_id: "q", quantity: 1, unit_price: 5000 }],
      returns: [
        {
          id: "r",
          settlement_id: null,
          product_id: "q",
          quantity: 2,
          imei_unit_id: null,
          is_damaged: false,
          returned_at: "",
        },
      ],
    }).get("q");
    expect(row && row.issued - row.sold - row.returned).toBe(2);
  });
});
