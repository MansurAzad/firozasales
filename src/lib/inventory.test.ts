import { describe, expect, it } from "vitest";
import type { AccountingSnapshot } from "./accounting";
import { companyStock } from "./inventory";

const snapshot: AccountingSnapshot = {
  profiles: [],
  roles: [],
  products: [
    {
      id: "button",
      name: "Button phone",
      category: "button_phone",
      price: 1000,
      model: "",
      created_at: "",
      is_active: true,
    },
    {
      id: "smart",
      name: "Smartphone",
      category: "smartphone",
      price: 10000,
      model: "",
      created_at: "",
      is_active: true,
    },
  ],
  imeiUnits: [
    {
      id: "u1",
      product_id: "smart",
      imei: "12345678901234",
      status: "in_dealer_stock",
      current_salesman: null,
      issued_at: null,
      sold_at: null,
      returned_at: null,
      created_at: "",
      is_damaged: false,
      is_voided: false,
      receipt_item_id: "receipt-item",
    },
    {
      id: "u2",
      product_id: "smart",
      imei: "22345678901234",
      status: "in_dealer_stock",
      current_salesman: null,
      issued_at: null,
      sold_at: null,
      returned_at: null,
      created_at: "",
      is_damaged: true,
      is_voided: false,
      receipt_item_id: "receipt-item",
    },
    {
      id: "u3",
      product_id: "smart",
      imei: "32345678901234",
      status: "in_dealer_stock",
      current_salesman: null,
      issued_at: null,
      sold_at: null,
      returned_at: null,
      created_at: "",
      is_damaged: false,
      is_voided: true,
      receipt_item_id: "receipt-item",
    },
  ],
  retailers: [],
  sales: [],
  saleItems: [],
  payments: [],
  deposits: [],
  returns: [
    {
      id: "return",
      settlement_id: null,
      salesman_id: "sr",
      product_id: "button",
      quantity: 2,
      imei_unit_id: null,
      is_damaged: false,
      returned_at: "",
    },
  ],
  stockIssues: [{ id: "issue", salesman_id: "sr", issued_by: "admin", issued_at: "", note: "" }],
  issueItems: [
    { id: "issue-item", issue_id: "issue", product_id: "button", quantity: 3, imei_unit_id: null },
  ],
  settlements: [],
  inventoryReceipts: [],
  inventoryReceiptItems: [
    {
      id: "receipt-item",
      receipt_id: "receipt",
      product_id: "button",
      quantity: 10,
      unit_cost: 250,
      created_at: "",
    },
  ],
  dealerReturns: [],
  dealerReturnItems: [],
  transactionReversals: [],
};

describe("company stock", () => {
  it("counts button-phone receipts and good returns, then subtracts issues", () => {
    expect(companyStock(snapshot, "button")).toBe(9);
  });

  it("excludes damaged and voided smartphone units from available stock", () => {
    expect(companyStock(snapshot, "smart")).toBe(1);
  });

  it("returns zero for unknown products", () => {
    expect(companyStock(snapshot, "missing")).toBe(0);
  });
});
