import { describe, expect, it } from "vitest";
import {
  assertDeviceReplace,
  backupLimit,
  createDeviceBackup,
  parseDeviceBackup,
} from "./device-backup";
import type { LocalAccount } from "./offline-store";
const uid = "3282c5d2-d42a-40ca-ab67-f00fd24a043b";
const account: LocalAccount = {
  role: { userId: uid, fullName: "Admin", isAdmin: true, isActive: true },
  entries: [],
  extras: { token: "must-not-export" },
  snapshot: {
    profiles: [],
    roles: [],
    products: [],
    retailers: [],
    imeiUnits: [],
    sales: [],
    saleItems: [],
    payments: [],
    deposits: [],
    returns: [],
    stockIssues: [],
    issueItems: [],
    settlements: [],
    inventoryReceipts: [],
    inventoryReceiptItems: [],
    dealerReturns: [],
    dealerReturnItems: [],
    transactionReversals: [],
  },
};
describe("device backups", () => {
  it("round trips saved authorized snapshot without credentials or role cache", () => {
    const source = createDeviceBackup(account, "project");
    expect(source).not.toContain("must-not-export");
    expect(JSON.parse(source).role).toBeUndefined();
    expect(parseDeviceBackup(source, uid, "project").snapshot).toEqual(account.snapshot);
  });
  it("rejects backups from another account", () =>
    expect(() =>
      parseDeviceBackup(createDeviceBackup(account, "project"), "different", "project"),
    ).toThrow("Different account"));
  it("rejects backups from another project", () =>
    expect(() => parseDeviceBackup(createDeviceBackup(account, "project"), uid, "other")).toThrow(
      "Different account",
    ));
  it("never replays restored pending financial entries", () =>
    expect(() =>
      parseDeviceBackup(
        createDeviceBackup(
          {
            ...account,
            entries: [{ id: uid, kind: "payment", payload: { amount: 5 }, createdAt: "" }],
          },
          "project",
        ),
        uid,
        "project",
      ),
    ).toThrow("Unverified"));
  it("blocks reset and replacement with any pending entry, including acknowledged entries", () =>
    expect(() =>
      assertDeviceReplace({
        ...account,
        entries: [{ id: uid, kind: "payment", payload: {}, createdAt: "", confirmed: true }],
      }),
    ).toThrow("Synchronize"));
  it("rejects incomplete snapshots", () =>
    expect(() =>
      parseDeviceBackup(
        JSON.stringify({ ...JSON.parse(createDeviceBackup(account, "project")), snapshot: {} }),
        uid,
        "project",
      ),
    ).toThrow("Invalid backup"));
  it("limits imports to 25 MB", () =>
    expect(() => parseDeviceBackup(" ".repeat(backupLimit + 1), uid, "project")).toThrow("25 MB"));
});
