import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { projectEntries, readAccount, writeAccount, type LocalEntry } from "./offline-store";
import { refuseServiceWorker } from "./pwa";
import type { AccountingSnapshot } from "./accounting";
const actor = { userId: "sr", isAdmin: false, isActive: true, fullName: "SR" };
function base(): AccountingSnapshot {
  return {
    profiles: [{ id: "sr", full_name: "SR", is_active: true, created_at: "" }],
    roles: [],
    products: [
      {
        id: "p",
        name: "Nokia",
        category: "button_phone",
        model: "",
        price: 1000,
        is_active: true,
        created_at: "",
      },
    ],
    imeiUnits: [],
    retailers: [
      { id: "r", name: "Dealer", phone: "", address: "", is_active: true, created_at: "" },
    ],
    sales: [
      {
        id: "sale",
        retailer_id: "r",
        salesman_id: "sr",
        paid_amount: 20000,
        total_amount: 31000,
        note: "",
        sold_at: "",
      },
    ],
    saleItems: [],
    payments: [],
    deposits: [
      {
        id: "d",
        amount: 15000,
        salesman_id: "sr",
        settlement_id: null,
        deposited_at: "",
        note: "",
      },
    ],
    returns: [],
    stockIssues: [{ id: "i", salesman_id: "sr", issued_by: "admin", issued_at: "", note: "" }],
    issueItems: [{ id: "ii", issue_id: "i", product_id: "p", quantity: 5, imei_unit_id: null }],
    settlements: [],
    inventoryReceipts: [],
    inventoryReceiptItems: [],
    dealerReturns: [],
    dealerReturnItems: [],
    transactionReversals: [],
  };
}
function entry(kind: LocalEntry["kind"], payload: LocalEntry["payload"]): LocalEntry {
  return { kind, payload, id: "request", createdAt: "2026-11-01T12:00:00Z" };
}
describe("offline rules", () => {
  it("rejects deleting a product referenced by stock issues", () =>
    expect(() =>
      projectEntries(
        base(),
        [entry("catalog", { table: "products", action: "delete", rows: [{ id: "p" }] })],
        { ...actor, isAdmin: true },
      ),
    ).toThrow("history exists"));
  it("keeps a rejected product deletion from breaking views with newer server history", () =>
    expect(
      projectEntries(
        base(),
        [
          {
            ...entry("catalog", {
              table: "products",
              action: "delete",
              rows: [{ id: "p" }],
            }),
            error: "Stock or history exists; deactivate this product instead",
          },
        ],
        { ...actor, isAdmin: true },
      ).products,
    ).toHaveLength(1));
  it("does not project the original request after it is explicitly superseded", () =>
    expect(
      projectEntries(
        base(),
        [
          {
            ...entry("catalog", {
              table: "products",
              action: "delete",
              rows: [{ id: "p" }],
            }),
            supersededBy: "replacement",
          },
          entry("catalog", {
            table: "products",
            action: "update",
            rows: [{ id: "p", is_active: false }],
          }),
        ],
        { ...actor, isAdmin: true },
      ).products[0]?.is_active,
    ).toBe(false));
  it("rejects deleting a dealer referenced by sales", () =>
    expect(() =>
      projectEntries(
        base(),
        [entry("catalog", { table: "retailers", action: "delete", rows: [{ id: "r" }] })],
        { ...actor, isAdmin: true },
      ),
    ).toThrow("history exists"));
  it("allows deleting an unused product", () => {
    const data = base();
    data.issueItems = [];
    expect(
      projectEntries(
        data,
        [entry("catalog", { table: "products", action: "delete", rows: [{ id: "p" }] })],
        { ...actor, isAdmin: true },
      ).products,
    ).toHaveLength(0);
  });
  it("keeps saved accounts separate by authenticated user", async () => {
    await writeAccount("a", () => ({
      role: { ...actor, userId: "a" },
      entries: [],
      extras: {},
      snapshot: base(),
    }));
    expect(await readAccount("b")).toBeUndefined();
    expect((await readAccount("a"))?.role.userId).toBe("a");
  });
  it("persists entries across database reads", async () => {
    await writeAccount("persist", () => ({
      role: actor,
      entries: [entry("payment", { retailer_id: "r", amount: 3000 })],
      extras: {},
    }));
    expect((await readAccount("persist"))?.entries[0]?.payload).toEqual({
      retailer_id: "r",
      amount: 3000,
    });
  });
  it("serializes concurrent updates without losing either entry", async () => {
    await writeAccount("concurrent", () => ({ role: actor, entries: [], extras: {} }));
    await Promise.all(
      ["one", "two"].map((id) =>
        writeAccount("concurrent", (current) => {
          if (!current) throw new Error("Missing account");
          return {
            ...current,
            entries: [...current.entries, { ...entry("payment", { amount: 1 }), id }],
          };
        }),
      ),
    );
    expect((await readAccount("concurrent"))?.entries.map((e) => e.id).sort()).toEqual([
      "one",
      "two",
    ]);
  });
  it("projects 3000 collection and 8000 deposit in order without changing saved base", () => {
    const d = base(),
      projected = projectEntries(
        d,
        [
          entry("payment", { retailer_id: "r", amount: 3000 }),
          { ...entry("settlement", { returns: [], deposits: [{ amount: 8000 }] }), id: "second" },
        ],
        actor,
      );
    expect(projected.payments[0]?.amount).toBe(3000);
    expect(projected.deposits[1]?.amount).toBe(8000);
    expect(d.payments).toHaveLength(0);
  });
  it("limits offline deposits after cash refunds", () =>
    expect(() =>
      projectEntries(
        {
          ...base(),
          dealerReturns: [
            {
              id: "return",
              sale_id: "sale",
              retailer_id: "r",
              salesman_id: "sr",
              created_by: "admin",
              total_amount: 1000,
              refund_amount: 1000,
              credit_amount: 0,
              note: "",
              created_at: "",
            },
          ],
        },
        [
          entry("settlement", {
            returns: [],
            deposits: [{ amount: 4500 }],
          }),
        ],
        actor,
      ),
    ).toThrow("Invalid cash amount"));
  it("rejects collection beyond the saved 11000 due", () =>
    expect(() =>
      projectEntries(base(), [entry("payment", { retailer_id: "r", amount: 11000.01 })], actor),
    ).toThrow());
  it("rejects deposit beyond saved 5000 cash", () =>
    expect(() =>
      projectEntries(
        base(),
        [entry("settlement", { returns: [], deposits: [{ amount: 5000.01 }] })],
        actor,
      ),
    ).toThrow());
  it("rejects selling more than five saved button phones", () =>
    expect(() =>
      projectEntries(
        base(),
        [
          entry("sale", {
            retailer_id: "r",
            paid_amount: 0,
            items: [{ product_id: "p", quantity: 6, unit_price: 1000, unit_ids: [] }],
          }),
        ],
        actor,
      ),
    ).toThrow());
  it("projects quantity returns without an IMEI", () =>
    expect(
      projectEntries(
        base(),
        [
          entry("settlement", {
            returns: [{ product_id: "p", quantity: 2, unit_ids: [] }],
            deposits: [],
          }),
        ],
        actor,
      ).returns[0]?.quantity,
    ).toBe(2));
  it("projects inventory receipts and uses them for subsequent stock issue checks", () => {
    const receipt = entry("inventory_receipt", {
      source: "purchase",
      supplier: "Supplier",
      note: "",
      items: [{ product_id: "p", quantity: 10, unit_cost: 250, units: [] }],
    });
    const projected = projectEntries(base(), [receipt], { ...actor, isAdmin: true });
    expect(projected.inventoryReceiptItems[0]?.unit_cost).toBe(250);
    expect(projected.inventoryReceipts[0]?.supplier).toBe("Supplier");
    expect(projected.inventoryReceiptItems[0]?.quantity).toBe(10);
  });
  it("rejects offline stock issue beyond company inventory after saved issues", () => {
    const receipt = entry("inventory_receipt", {
      source: "opening",
      supplier: "",
      note: "",
      items: [{ product_id: "p", quantity: 10, unit_cost: 0, units: [] }],
    });
    const issue = {
      ...entry("issue", {
        salesman_id: "sr",
        items: [{ product_id: "p", quantity: 6, unit_ids: [] }],
      }),
      id: "issue-2",
    };
    expect(() => projectEntries(base(), [receipt, issue], { ...actor, isAdmin: true })).toThrow(
      "Insufficient saved company stock",
    );
  });
  it("rejects inactive local financial entries", () =>
    expect(() =>
      projectEntries(base(), [entry("payment", { retailer_id: "r", amount: 1 })], {
        ...actor,
        isActive: false,
      }),
    ).toThrow());
  it("blocks preview, iframe, development and kill-switch workers while allowing published domains", () => {
    expect(refuseServiceWorker("id-preview--abc.lovable.app", true, false, false)).toBe(true);
    expect(refuseServiceWorker("preview-2--abc.gpt-eng.com", true, false, false)).toBe(true);
    expect(refuseServiceWorker("project--abc-dev.lovable.app", true, false, false)).toBe(true);
    expect(refuseServiceWorker("firozasales.lovable.app", true, true, false)).toBe(true);
    expect(refuseServiceWorker("firozasales.lovable.app", false, false, false)).toBe(true);
    expect(refuseServiceWorker("firozasales.lovable.app", true, false, true)).toBe(true);
    expect(refuseServiceWorker("firozasales.lovable.app", true, false, false)).toBe(false);
    expect(refuseServiceWorker("preview-v2--shop.example.com", true, false, false)).toBe(false);
  });
});
